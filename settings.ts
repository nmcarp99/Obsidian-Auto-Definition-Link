import AutoDefinitionLink from "main";
import { App, PluginSettingTab, Setting } from "obsidian";
import { updateBlockIds } from "updateBlockIds";

export interface AutoDefinitionLinkSettings {
    useSuggestions: boolean;
    useAutoLink: boolean;
    searchFileContent: boolean;
    subFolderDepth: number;
}

export const DEFAULT_SETTINGS: AutoDefinitionLinkSettings = {
    useSuggestions: false,
    useAutoLink: true,
    searchFileContent: true,
    subFolderDepth: -1,
}

export class AutoDefinitionLinkSettingTab extends PluginSettingTab {
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

        new Setting(containerEl)
            .setName('Search file content')
            .setDesc('If disabled, the plugin will only use the names of files and not the contents of files to find links. If you are having performance issues, DISABLE THIS.')
            .addToggle((toggle) => {
                toggle.setValue(AutoDefinitionLink.settings.searchFileContent)
                    .onChange(async (value) => {
                        AutoDefinitionLink.settings.searchFileContent = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Subfolder depth')
            .setDesc('How many subfolders deep to match link destinations; 0 = current folder only; -1 = all subfolders')
            .addText((text) => {
                text.setValue(AutoDefinitionLink.settings.subFolderDepth.toString())
                    .onChange(async (value) => {
                        AutoDefinitionLink.settings.subFolderDepth = parseInt(value);
                        await this.plugin.saveSettings();
                    });

                text.inputEl.type = 'number';
                text.inputEl.min = '-1';
            });

        new Setting(containerEl)
            .setName('Refresh Links')
            .setDesc('Refreshes the links in the current vault. This may take a while.')
            .addButton((button) => {
                button.setButtonText('Refresh Links')
                    .onClick(async () => {
                        const editor = this.app.workspace.activeEditor?.editor;

                        if (!editor) return;

                        updateBlockIds(this.app, editor);
                    });
            });
    }

}