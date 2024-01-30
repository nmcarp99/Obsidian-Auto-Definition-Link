import AutoDefinitionLink from "main";
import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from "obsidian";
import { BLOCKIDREGEX, SuggestionData } from "shared";
import { _updateBlockIds } from "updateBlockIds";

export class AutoDefinitionLinkSuggest extends EditorSuggest<SuggestionData> {
    constructor(app: App) {
        super(app);
    }

    async getSuggestions(context: EditorSuggestContext): Promise<SuggestionData[]> {
        return AutoDefinitionLink.getSuggestions(context.query, context.editor.getCursor());
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
        if (!AutoDefinitionLink.settings.useSuggestions) return null;
        if (AutoDefinitionLink.linkDestinations.length === 0) return null;

        const originalLine = editor.getLine(cursor.line);
        if (originalLine.length === 0) return null;
        const textBeforeCursor = originalLine.slice(0, cursor.ch);

        // handle editing block ids
        const carrotIndex = originalLine.indexOf(' ^');
        if (carrotIndex !== -1 && originalLine.slice(carrotIndex, cursor.ch).match(BLOCKIDREGEX)) {
            _updateBlockIds(this.app, editor);

            return null; // cancel if editing a term
        }

        return {
            start: cursor, // TODO space setting (also change end to use cursorPosBeforeSpace)
            end: cursor,
            query: textBeforeCursor || '',
        };
    }

    renderSuggestion(item: SuggestionData, el: HTMLElement): void {
        el.setText(item.linkDestination.linkPath);
    }

    selectSuggestion(item: SuggestionData, evt: MouseEvent | KeyboardEvent): void {
        this.close();

        const editor = this.app.workspace.activeEditor?.editor;

        if (!editor) return;

        AutoDefinitionLink.replaceSuggestion(item, editor);
    }
}