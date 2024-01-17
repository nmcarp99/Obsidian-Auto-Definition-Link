import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, Plugin, PluginSettingTab, Setting, TFile, debounce, parseYaml } from "obsidian";
import { singular } from "pluralize";

// make sure last key pressed is space, make sure the cursor is right after the found one

interface AutoDefinitionLinkSettings {
    useSuggestions: boolean;
    useAutoLink: boolean;
}

const DEFAULT_SETTINGS: AutoDefinitionLinkSettings = {
    useSuggestions: false,
    useAutoLink: true,
}

const updateBlockIds = debounce(_updateBlockIds, 1000);

async function _updateBlockIds(app: App, editor: Editor, path = "") {
    const linkDestinations: LinkDestination[] = [];

    function processFileContents(contents: string, path: string) {
        const matches = contents.matchAll(/ \^([a-zA-Z0-9-]+$)/gm);

        Array.from(matches).forEach((match) => {
            linkDestinations.push({
                linkPath: path + '#^' + match[1],
                searchValue: match[1],
                numTerms: match[1].split(/[ -]/).length,
            });
        });

        // match aliases of file name
        const properties = Array.from(contents.matchAll(/---\n((?:.|\n)*?)\n---/gm));
        if (!properties || properties.length === 0 || properties[0].length < 2) return;

        const aliases = parseYaml(properties[0][1]).aliases as string[];
        if (!aliases) return;

        linkDestinations.push(
            ...aliases.map((alias: string) => ({
                linkPath: path,
                searchValue: alias,
                numTerms: alias.split(/[ -]/).length
            }))
        );
    }

    const activeFile = app.workspace.getActiveFile();

    const files = app.vault.getMarkdownFiles();
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.parent?.path !== activeFile?.parent?.path) continue; // skip if the file is in not the same folder as the active file

        linkDestinations.push({
            linkPath: file.basename,
            searchValue: file.basename,
            numTerms: file.basename.split(/[ -]/).length
        });

        // if the file is the active file, use the editor contents instead of reading the file (since the file may not be saved yet)
        if (file.path == activeFile?.path) {
            processFileContents(editor.getValue(), file.path);

            continue;
        }

        const contents = await app.vault.read(file);
        processFileContents(contents, file.path);
    }

    AutoDefinitionLink.linkDestinations = linkDestinations;
}

function normalizeId(id: string): string {
    return id.replace(/ /g, '-').toLowerCase().split('-').map((word) => singular(word)).join('-');
}

type SuggestionData = {
    text: string,
    linkDestination: LinkDestination,
    cursor: EditorPosition,
};

type LinkDestination = {
    linkPath: string, // where it should link to
    searchValue: string, // what to search for to find the link
    numTerms: number, // number of terms in the search value
};

class AutoDefinitionLinkSuggest extends EditorSuggest<SuggestionData> {
    constructor(app: App) {
        super(app);
    }

    async getSuggestions(context: EditorSuggestContext): Promise<SuggestionData[]> {
        const suggestions: SuggestionData[] = [];

        AutoDefinitionLink.linkDestinations.forEach((linkDestination) => { // loop through each definition in file
            // select text going backwards for the number of terms in the block id
            const substr = (context.query.match(new RegExp(`(?:[ -]{0,1}[^ -]*){${linkDestination.numTerms}}$`)) || [''])[0].replace(/^[ -]/, '');

            if (!substr) return;

            if (!normalizeId(linkDestination.searchValue).startsWith(normalizeId(substr))) return;

            // const cursorPos = context.editor.getCursor(); TODO space setting (also change suggestions.push to use cursorPosBeforeSpace)
            // const cursorPosBeforeSpace = { line: cursorPos.line, ch: cursorPos.ch - 1 };

            suggestions.push({
                text: substr,
                linkDestination,
                cursor: context.editor.getCursor(),
            });
        });

        return suggestions.sort((a, b) => b.linkDestination.numTerms - a.linkDestination.numTerms);
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
        if (!AutoDefinitionLink.settings.useSuggestions) return null;

        if (AutoDefinitionLink.linkDestinations.length === 0) return null;

        // const cursorPos = cursor;
        // const cursorPosBeforeSpace = { line: cursorPos.line, ch: cursorPos.ch - 1 };
        const originalLine = editor.getLine(cursor.line);

        if (originalLine.length === 0) return null;

        if (originalLine.substring(0, cursor.ch).match(/\^([a-zA-Z0-9-]+$)/)) {
            updateBlockIds(this.app, editor);

            return null; // cancel if editing a term
        }

        // if (originalLine.charAt(cursorPosBeforeSpace.ch) !== ' ') return null; // TODO space setting
        // console.debug('space found');

        // text representing the valid text for a blockid directly before the cursor
        const possibleBlockIdContainingStr = (originalLine.substring(0, cursor.ch) || ''); // TODO space setting

        return {
            start: cursor, // TODO space setting (also change end to use cursorPosBeforeSpace)
            end: cursor,
            query: possibleBlockIdContainingStr,
        };
    }

    renderSuggestion(item: SuggestionData, el: HTMLElement): void {
        el.setText(item.linkDestination.linkPath);
    }

    selectSuggestion(item: SuggestionData, evt: MouseEvent | KeyboardEvent): void {
        this.close();

        const editor = this.app.workspace.activeEditor?.editor;

        if (!editor) return;

        // if shift is pressed, insert the actual name of the block
        // if (evt.shiftKey) return editor.replaceRange(`[[#^${item.id}|${item.id}]]`, { line: item.cursor.line, ch: item.cursor.ch - item.text.length }, item.cursor);

        editor.replaceRange(`[[${item.linkDestination.linkPath}|${item.text}]]`, { line: item.cursor.line, ch: item.cursor.ch - item.text.length }, item.cursor);
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

        new Setting(containerEl)
            .setName('Use suggestions')
            .setDesc('If disabled, the plugin will not suggest links to replace block ids with')
            .addToggle((toggle) => {
                toggle.setValue(AutoDefinitionLink.settings.useSuggestions)
                    .onChange(async (value) => {
                        AutoDefinitionLink.settings.useSuggestions = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Use auto link')
            .setDesc('If disabled, the plugin will not automatically convert a block id to a link after pressing space (or another valid interrupter)')
            .addToggle((toggle) => {
                toggle.setValue(AutoDefinitionLink.settings.useAutoLink)
                    .onChange(async (value) => {
                        AutoDefinitionLink.settings.useAutoLink = value;
                        await this.plugin.saveSettings();
                    });
            });
    }

}

export default class AutoDefinitionLink extends Plugin {
    public static linkDestinations: LinkDestination[] = [];
    public static settings: AutoDefinitionLinkSettings;

    lastKey: string;
    lastKeyShift: boolean;

    async onload() {
        await this.loadSettings();

        const editor = this.app.workspace.activeEditor?.editor;

        if (editor) {
            updateBlockIds(this.app, editor);
        }

        const autoDefinitionLinkSuggest = new AutoDefinitionLinkSuggest(this.app);
        this.registerEditorSuggest(autoDefinitionLinkSuggest);

        this.registerEvent(
            this.app.workspace.on("layout-change", async () => {

                const editor = this.app.workspace.activeEditor?.editor;

                if (!editor) return;

                updateBlockIds(this.app, editor);
            })
        );

        this.registerDomEvent(document, 'keydown', (evt: KeyboardEvent) => {
            this.lastKey = evt.key;
            this.lastKeyShift = evt.shiftKey;
        });

        this.registerEvent(
            this.app.workspace.on('editor-change', (editor) => {
                if (!AutoDefinitionLink.settings.useAutoLink) return;

                const cursorPos = editor.getCursor();
                const cursorPosBeforeSpace = { line: cursorPos.line, ch: cursorPos.ch - 1 };
                const originalLine = editor.getLine(cursorPos.line);

                if (originalLine.length === 0) return;

                if (originalLine.substring(0, cursorPos.ch).match(/\^([a-zA-Z0-9-]+$)/)) {
                    updateBlockIds(this.app, editor);

                    return; // cancel if editing a term
                }

                const validInterrupters = /[?.!, ]/;

                if (!this.lastKey?.match(validInterrupters)) return; // cancel if the last key pressed is not a valid interrupter

                if (this.lastKeyShift && this.lastKey === ' ') return; // cancel if shift is pressed with space (shift + space is used to insert the actual name of the block)

                // if (originalLine.charAt(cursorPosBeforeSpace.ch) !== ' ') return;

                if (AutoDefinitionLink.linkDestinations.length === 0) return;

                const matchingLinks: {
                    linkDestination: LinkDestination,
                    text: string,
                }[] = [];

                AutoDefinitionLink.linkDestinations.forEach((linkDestination) => { // loop through each definition in file
                    // text representing the valid text for a blockid directly before the cursor
                    const possibleBlockIdContainingStr = (originalLine.substring(0, cursorPosBeforeSpace.ch) || '');

                    // select text going backwards for the number of terms in the block id
                    const substr = (possibleBlockIdContainingStr.match(new RegExp(`(?:[ -]{0,1}[^ -]*){${linkDestination.numTerms}}$`)) || [''])[0].replace(/^[ -]/, '');

                    if (normalizeId(substr) === normalizeId(linkDestination.searchValue)) {
                        matchingLinks.push({
                            linkDestination,
                            text: substr,
                        });
                    }
                });

                if (matchingLinks.length === 0) return;

                const { linkDestination: longestMatchingLink, text } = matchingLinks.sort((a, b) => b.linkDestination.numTerms - a.linkDestination.numTerms)[0];

                editor.replaceRange(`[[${longestMatchingLink.linkPath}|${text}]]`, { line: cursorPosBeforeSpace.line, ch: cursorPosBeforeSpace.ch - text.length }, cursorPosBeforeSpace);
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