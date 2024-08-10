import AutoDefinitionLink from "src/main";
import { App, MarkdownPostProcessorContext, TFile } from "obsidian";
import { findSuggestionsInText, internalLinkElement } from "src/shared";
import { getBackLinks } from "./getBackLinks";

export function autoDefinitionLinkPostProcessor(el: HTMLElement, ctx: MarkdownPostProcessorContext, app: App) {
    if (!AutoDefinitionLink.settings.realTimeLinking) return;

    function generateBacklinksDiv() {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.flexWrap = 'wrap';
        div.style.justifyContent = 'center';
        div.style.alignItems = 'center';
        div.style.margin = '1em 0';
        div.style.marginTop = '5em';
        div.style.padding = '.8em';
        div.style.border = '1px solid #5555ff30';
        div.style.borderRadius = '1em';
        div.style.backgroundColor = '#5555ff10';
        div.style.width = '100%';
        div.style.maxWidth = '100%';
        div.style.overflow = 'hidden';
        div.style.textOverflow = 'ellipsis';
        div.style.whiteSpace = 'nowrap';
        div.style.fontFamily = 'var(--font-monospace)';
        div.style.fontSize = '.8em';
        div.style.lineHeight = 'var(--line-height-small)';
        div.style.color = '#000000';
        div.setAttribute('is-backlinks', 'true');

        return div;
    }

    function populateBacklinkDiv(div: Element, backlinks: TFile[]) {
        while (div.firstChild) {
            div.removeChild(div.firstChild);
        }

        if (!backlinks.length) {
            div.appendChild(document.createTextNode('No backlinks'));
            return;
        }

        backlinks.map(file => internalLinkElement(file.path, file.basename)).forEach(link => {
            link.style.padding = '.2em 1.2em';
            link.style.margin = '.2em';
            link.style.background = '#5555ff30';
            link.style.borderRadius = '1em';
            link.style.textDecoration = 'none';

            div.appendChild(link);
        });
    }

    // wait for footer to exist
    const footerObserver = new MutationObserver((mutations) => {
        // get the footer and header elements, filtering so that we only get the one belonging to the current file (same parent)
        const footerElement = Array.from(document.querySelectorAll('.mod-footer')).filter(footer => el.parentElement?.contains(footer))[0];
        const headerElement = Array.from(document.querySelectorAll('.mod-header')).filter(header => el.parentElement?.contains(header))[0];

        (window as any).x = el;

        if (!footerElement || !headerElement) return;

        footerObserver.disconnect();

        if (!el.matches('.mod-header + div')) return; // only run for the first node after the header (so we don't run multiple times on the same file)

        // only update if we've already added backlinks
        const existingBacklinksDiv = footerElement.querySelector('div[is-backlinks="true"]');
        if (existingBacklinksDiv) {
            getBackLinks(app).then((backlinks) => {
                populateBacklinkDiv(existingBacklinksDiv, backlinks);
            });
            return;
        }

        const newBacklinksDiv = generateBacklinksDiv();

        getBackLinks(app).then((backlinks) => {
            populateBacklinkDiv(newBacklinksDiv, backlinks);

            footerElement.appendChild(newBacklinksDiv);
        });
    });

    footerObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    // stop observing after 5 seconds to prevent memory leaks
    setTimeout(() => footerObserver.disconnect(), 5000);

    function getTextRecursively(element: Element): { [text: string]: Node } {
        let texts: {
            [text: string]: Node
        } = {};

        const children = Array.from(element.childNodes);

        children.forEach(child => {
            if (child instanceof HTMLElement && child.hasClass('internal-link')) return;

            if (child.nodeType === Node.TEXT_NODE) {
                if (!child.textContent) return;

                return texts[child.textContent] = child;
            }

            if (!(child instanceof HTMLElement)) return;

            texts = {
                ...texts,
                ...getTextRecursively(child)
            };
        })


        return texts;
    }

    const textMap = getTextRecursively(el);

    Object.entries(textMap).forEach(([text, element]) => {
        const suggestions = findSuggestionsInText(text).reverse();

        suggestions.forEach((suggestion) => {
            // make sure to leave the original node as the first child - do not replace it
            const beginningText = element.textContent?.slice(0, suggestion.from) ?? '';
            const endText = element.textContent?.slice(suggestion.to) ?? '';

            element.nodeValue = beginningText;
            const newLinkNode = element.parentNode?.insertAfter(internalLinkElement(suggestion.suggestion.linkDestination.linkPath, suggestion.suggestion.text), element);

            if (!newLinkNode) throw new Error('newLinkNode is null');

            element.parentNode?.insertAfter(document.createTextNode(endText), newLinkNode);
        });
    });
}