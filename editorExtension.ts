import { RangeSetBuilder } from "@codemirror/state";
import {
    Decoration,
    DecorationSet,
    EditorView,
    PluginSpec,
    PluginValue,
    ViewPlugin,
    ViewUpdate,
    WidgetType,
} from "@codemirror/view";
import AutoDefinitionLink from "main";
import { SuggestionData, TERMSPLITTERS, internalLinkElement } from "shared";

export class LinkWidget extends WidgetType {
    href: string;
    text: string;

    constructor(href: string, text: string) {
        super();

        this.href = href;
        this.text = text;
    }

    toDOM(view: EditorView): HTMLElement {
        return internalLinkElement(this.href, this.text);
    }
}

class AutoDefinitionLinkEditorExtension implements PluginValue {
    decorations: DecorationSet;

    constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
        if (!AutoDefinitionLink.settings.realTimeLinking) return;

        if (update.docChanged || update.viewportChanged || update.selectionSet) {
            this.decorations = this.buildDecorations(update.view);
        }
    }

    destroy() { }

    buildDecorations(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const state = view.state;

        for (let curLineNumber = 1; curLineNumber <= state.doc.lines; curLineNumber++) {
            const curLine = state.doc.line(curLineNumber);

            // get separating indices
            // reverse to get most terms (least likely to match) first
            const indices: number[] = Array.from(curLine.text.matchAll(TERMSPLITTERS)).map((match) => match.index ?? 0);
            indices.push(curLine.text.length); // add the end of the string (so the last term can be matched)
            indices.reverse();

            // we must search for links in reverse order, so that we can block off indices; then, we have to reverse and add them to the builder
            const suggestionsToAdd: {
                suggestion: SuggestionData,
                from: number,
                to: number,
            }[] = [];

            // blocked off by linked text. for example: files: text, text cat; text: text cat; make sure it only links the longer one
            const blockedIndexIndices: number[] = [];

            // loop through separating indices
            indices.forEach((i, indexOfIndex) => {
                // just use first suggestion for now
                const suggestions = AutoDefinitionLink.getSuggestions(curLine.text.slice(0, i), { line: 0, ch: 0 });

                if (!suggestions.length) return;

                const suggestion = suggestions[0];

                // if the suggestion is blocked, skip it
                if (blockedIndexIndices.includes(indexOfIndex)) return;

                // depending on the number of terms in suggestion, block off the next indices
                for (let j = 1; j < suggestion.linkDestination.numTerms; j++) {
                    if (blockedIndexIndices.includes(indexOfIndex + j)) continue;
                    blockedIndexIndices.push(indexOfIndex + j);
                }

                suggestionsToAdd.push({
                    suggestion,
                    from: curLine.from + i - suggestion.text.length,
                    to: curLine.from + i,
                });
            });

            // add suggestions to builder
            suggestionsToAdd.reverse().forEach((suggestion) => {
                builder.add(
                    suggestion.from,
                    suggestion.to,
                    (state.selection.main.from <= curLine.to && state.selection.main.to >= curLine.from ? // if the selection is in the line (starts before and ends after)
                        Decoration.mark({
                            attributes: {
                                style: 'text-decoration: underline; text-decoration-color: #55f; text-decoration-thickness: 3px;'
                            }
                        }) :
                        Decoration.replace({
                            widget: new LinkWidget(suggestion.suggestion.linkDestination.linkPath, suggestion.suggestion.text),
                        })
                    )
                );
            });
        }

        return builder.finish();
    }
}

const pluginSpec: PluginSpec<AutoDefinitionLinkEditorExtension> = {
    decorations: (value: AutoDefinitionLinkEditorExtension) => value.decorations,
};

export const autoDefinitionLinkEditorExtension = ViewPlugin.fromClass(
    AutoDefinitionLinkEditorExtension,
    pluginSpec
);