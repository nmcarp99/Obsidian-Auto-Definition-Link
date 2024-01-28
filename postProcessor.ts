import AutoDefinitionLink from "main";
import { MarkdownPostProcessorContext } from "obsidian";
import { TERMSPLITTERS, internalLinkElement } from "shared";

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
        // get separating indices
        // reverse to get most terms (least likely to match) first
        const indices: number[] = Array.from(text.matchAll(TERMSPLITTERS)).map((match) => match.index ?? 0);
        indices.push(text.length); // add the end of the string (so the last term can be matched)
        indices.reverse();

        // loop through separating indices
        indices.forEach(i => {
            // just use first suggestion for now
            const suggestions = AutoDefinitionLink.getSuggestions(text.slice(0, i), { line: 0, ch: 0 });

            if (!suggestions.length) return;

            let usedSuggestion = false;

            suggestions.forEach((suggestion) => {
                if (usedSuggestion) return;

                if (element.nodeValue?.slice(i - suggestion.text.length, i) !== suggestion.text) return; // make sure it hasn't been modified by some link before this

                // make sure to leave the original node as the first child - do not replace it
                const beginningText = element.textContent?.slice(0, i - suggestion.text.length) ?? '';
                const endText = element.textContent?.slice(i) ?? '';

                element.nodeValue = beginningText;
                const newLinkNode = element.parentNode?.insertAfter(internalLinkElement(suggestion.linkDestination.linkPath, suggestion.text), element);

                if (!newLinkNode) throw new Error('newLinkNode is null');

                element.parentNode?.insertAfter(document.createTextNode(endText), newLinkNode);

                usedSuggestion = true;
            });
        })
    });
}