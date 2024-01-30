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
import AutoDefinitionLink from "src/main";
import { findSuggestionsInText, internalLinkElement } from "src/shared";

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

            findSuggestionsInText(curLine.text).forEach((suggestion) => {
                builder.add(
                    suggestion.from + curLine.from,
                    suggestion.to + curLine.from,
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