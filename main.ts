import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { singular } from "pluralize";

// make sure last key pressed is space, make sure the cursor is right after the found one

interface AutoDefinitionLinkSettings {
    useSuggestions: boolean;
}

const DEFAULT_SETTINGS: AutoDefinitionLinkSettings = {
    useSuggestions: false,
}

async function getBlockIds(app: App, editor: Editor, path = ""): Promise<string[]> {
    const blockIds: string[] = [];

    const filePromises: Promise<void>[] = [];

    function processFileContents(contents: string, path: string) {
        const matches = contents.matchAll(/ \^([a-zA-Z0-9-]+$)/gm);

        Array.from(matches).forEach((match) => {
            blockIds.push(path + '#^' + match[1]);
        });
    }

    const activeFile = app.workspace.getActiveFile();

    app.vault.getMarkdownFiles()
        .forEach((file) => {
            if (file.parent?.path !== activeFile?.parent?.path) return; // skip if the file is in not the same folder as the active file

            filePromises.push(new Promise((resolve) => {
                // if the file is the active file, use the editor contents instead of reading the file
                if (file.path == activeFile?.path) {
                    processFileContents(editor.getValue(), file.path);

                    resolve();
                    return;
                }

                app.vault.read(file)
                    .then((contents) => {
                        processFileContents(contents, file.path);

                        resolve();
                    });
            }));
        });

    await Promise.all(filePromises); // wait for all files to be read

    return blockIds;
}

function normalizeId(id: string): string {
    return id.replace(/ /g, '-').toLowerCase().split('-').map((word) => singular(word)).join('-');
}

type SuggestionData = {
    id: string,
    text: string,
    cursor: EditorPosition,
    numTerms: number,
};

class AutoDefinitionLinkSuggest extends EditorSuggest<SuggestionData> {
    constructor(app: App) {
        super(app);
    }

    async getSuggestions(context: EditorSuggestContext): Promise<SuggestionData[]> {
        const suggestions: SuggestionData[] = [];

        AutoDefinitionLink.blockIds.forEach((blockPath) => { // loop through each definition in file
            const blockId = blockPath.split('#^')[1];

            // number of terms in the block id
            const numTermsInBlockId = blockId.split(/[ -]/).length;

            // select text going backwards for the number of terms in the block id
            const substr = (context.query.match(new RegExp(`(?:[ -]{0,1}[^ -]*){${numTermsInBlockId}}$`)) || [''])[0].replace(/^[ -]/, '');

            if (normalizeId(substr) !== normalizeId(blockId)) return;

            // const cursorPos = context.editor.getCursor(); TODO space setting (also change suggestions.push to use cursorPosBeforeSpace)
            // const cursorPosBeforeSpace = { line: cursorPos.line, ch: cursorPos.ch - 1 };

            suggestions.push({
                text: substr,
                id: blockPath,
                cursor: context.editor.getCursor(),
                numTerms: numTermsInBlockId,
            });
        });

        return suggestions.sort((a, b) => b.numTerms - a.numTerms);
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
        if (!AutoDefinitionLink.settings.useSuggestions) return null;

        // const cursorPos = cursor;
        // const cursorPosBeforeSpace = { line: cursorPos.line, ch: cursorPos.ch - 1 };
        const originalLine = editor.getLine(cursor.line);

        if (originalLine.length === 0) return null;

        if (originalLine.match(/\^([a-zA-Z0-9-]+$)/)) {
            (async () => AutoDefinitionLink.blockIds = await getBlockIds(this.app, editor))();

            return null; // cancel if editing a term
        }

        // if (originalLine.charAt(cursorPosBeforeSpace.ch) !== ' ') return null; // TODO space setting
        // console.debug('space found');

        // text representing the valid text for a blockid directly before the cursor
        const possibleBlockIdContainingStr = (originalLine.substring(0, cursor.ch).match(/[a-zA-Z0-9- ]+$/) || [''])[0]; // TODO space setting

        return {
            start: cursor, // TODO space setting (also change end to use cursorPosBeforeSpace)
            end: cursor,
            query: possibleBlockIdContainingStr,
        };
    }

    renderSuggestion(item: SuggestionData, el: HTMLElement): void {
        el.setText(item.id.split("#^")[0] + '-' + item.text);
    }

    selectSuggestion(item: SuggestionData, evt: MouseEvent | KeyboardEvent): void {
        this.close();

        const editor = this.app.workspace.activeEditor?.editor;

        if (!editor) return;

        // if shift is pressed, insert the actual name of the block
        // if (evt.shiftKey) return editor.replaceRange(`[[#^${item.id}|${item.id}]]`, { line: item.cursor.line, ch: item.cursor.ch - item.text.length }, item.cursor);

        let link = item.id;

        if (this.app.workspace.getActiveFile()?.path === item.id.split('#^')[0]) link = '#^' + item.id.split('#^')[1];

        editor.replaceRange(`[[${link}|${item.text}]]`, { line: item.cursor.line, ch: item.cursor.ch - item.text.length }, item.cursor);
    }
}

class AutoDefinitionLinkSettingTab extends PluginSettingTab {
    plugin: AutoDefinitionLink;

    constructor(app: App, plugin: AutoDefinitionLink) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: 'Auto Definition Link Settings' });

        new Setting(containerEl)
            .setName('Use Suggestions')
            .setDesc('If disabled, the plugin will not suggest block ')
            .addToggle((toggle) => {
                toggle.setValue(AutoDefinitionLink.settings.useSuggestions)
                    .onChange(async (value) => {
                        AutoDefinitionLink.settings.useSuggestions = value;
                        await this.plugin.saveSettings();
                    });
            });
    }

}

export default class AutoDefinitionLink extends Plugin {
    public static blockIds: string[] = [];
    public static settings: AutoDefinitionLinkSettings;

    lastKey: string;
    lastKeyShift: boolean;

    async onload() {
        await this.loadSettings();

        const editor = this.app.workspace.activeEditor?.editor;

        if (editor) {
            AutoDefinitionLink.blockIds = await getBlockIds(this.app, editor);
        }

        const autoDefinitionLinkSuggest = new AutoDefinitionLinkSuggest(this.app);
        this.registerEditorSuggest(autoDefinitionLinkSuggest);

        this.registerEvent(
            this.app.workspace.on("layout-change", () => {

                const editor = this.app.workspace.activeEditor?.editor;

                if (!editor) return;

                getBlockIds(this.app, editor)
                    .then((blockIds) => AutoDefinitionLink.blockIds = blockIds);
            })
        );

        this.registerDomEvent(document, 'keydown', (evt: KeyboardEvent) => {
            this.lastKey = evt.key;
            this.lastKeyShift = evt.shiftKey;
        });

        this.registerEvent(
            this.app.workspace.on('editor-change', (editor) => {
                const cursorPos = editor.getCursor();
                const cursorPosBeforeSpace = { line: cursorPos.line, ch: cursorPos.ch - 1 };
                const originalLine = editor.getLine(cursorPos.line);

                if (originalLine.length === 0) return;

                if (originalLine.match(/\^([a-zA-Z0-9-]+$)/)) {
                    (async () => AutoDefinitionLink.blockIds = await getBlockIds(this.app, editor))();

                    return; // cancel if editing a term
                }

                const validInterrupters = /[?.!, ]/;

                if (!this.lastKey.match(validInterrupters)) return; // cancel if the last key pressed is not a valid interrupter

                if (this.lastKeyShift && this.lastKey === ' ') return; // cancel if shift is pressed with space (shift + space is used to insert the actual name of the block)

                // if (originalLine.charAt(cursorPosBeforeSpace.ch) !== ' ') return;

                if (AutoDefinitionLink.blockIds.length === 0) return;

                AutoDefinitionLink.blockIds.forEach((path) => { // loop through each definition in file
                    const blockId = path.split('#^')[1];

                    // text representing the valid text for a blockid directly before the cursor
                    const possibleBlockIdContainingStr = (originalLine.substring(0, cursorPosBeforeSpace.ch).match(/[a-zA-Z0-9- ]+$/) || [''])[0];

                    // number of terms in the block id
                    const numTermsInBlockId = blockId.split(/[ -]/).length;

                    // select text going backwards for the number of terms in the block id
                    const substr = (possibleBlockIdContainingStr.match(new RegExp(`(?:[ -]{0,1}[^ -]*){${numTermsInBlockId}}$`)) || [''])[0].replace(/^[ -]/, '');

                    if (normalizeId(substr) === normalizeId(blockId)) {
                        editor.replaceRange(`[[${path}|${substr}]]`, { line: cursorPosBeforeSpace.line, ch: cursorPosBeforeSpace.ch - substr.length }, cursorPosBeforeSpace);
                        return;
                    }
                });
            })
        );

        this.addSettingTab(new AutoDefinitionLinkSettingTab(this.app, this));
    }

    async loadSettings() {
        AutoDefinitionLink.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(AutoDefinitionLink.settings);
    }
}