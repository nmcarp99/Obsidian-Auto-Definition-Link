import AutoDefinitionLink from "src/main";
import { MarkdownPostProcessorContext } from "obsidian";
import { findSuggestionsInText, internalLinkElement } from "src/shared";

export function autoDefinitionLinkPostProcessor(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    if (!AutoDefinitionLink.settings.realTimeLinking) return;

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