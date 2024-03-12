import AutoDefinitionLink from "src/main";
import { App, PluginSettingTab, Setting } from "obsidian";
import { updateBlockIds } from "src/updateBlockIds";

export interface AutoDefinitionLinkSettings {
    useSuggestions: boolean;
    useAutoLink: boolean;
    searchFileContent: boolean;
    subFolderDepth: number;
    realTimeLinking: boolean;
    autoRefreshLinks: 'always' | 'main' | 'never';
    lemmatizeTerms: boolean;
}

export const DEFAULT_SETTINGS: AutoDefinitionLinkSettings = {
    useSuggestions: false,
    useAutoLink: false,
    searchFileContent: true,
    subFolderDepth: -1,
    realTimeLinking: true,
    autoRefreshLinks: 'always',
    lemmatizeTerms: true,
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
            .setName('Lemmatize Terms')
            .setDesc('Lemmatize terms in the search value. This will make the search value more flexible, but may also make it less accurate.')
            .addToggle((toggle) => {
                toggle.setValue(AutoDefinitionLink.settings.lemmatizeTerms)
                    .onChange(async (value) => {
                        AutoDefinitionLink.settings.lemmatizeTerms = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Search file content')
            .setDesc('If disabled, the plugin will only use the names of files and not the contents of files to find links (disabling will disable aliases in results). If you are having performance issues, DISABLE THIS.')
            .addToggle((toggle) => {
                toggle.setValue(AutoDefinitionLink.settings.searchFileContent)
                    .onChange(async (value) => {
                        AutoDefinitionLink.settings.searchFileContent = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Real-time linking')
            .setDesc('If enabled, the plugin will automatically show links without having to be suggested them. This means old files will link to new files without modifications. This may cause performance issues, however it has been tested with ~20K files and runs with <0ms latency. (May require reload after disabling)')
            .addToggle((toggle) => {
                toggle.setValue(AutoDefinitionLink.settings.realTimeLinking)
                    .onChange(async (value) => {
                        AutoDefinitionLink.settings.realTimeLinking = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Auto-refresh links')
            .setDesc('If enabled, the plugin will automatically refresh links when the vault is opened or a file is renamed, edited, deleted, or modified. This may take a couple of seconds (runs in background).')
            .addDropdown((dropdown) => {
                dropdown.addOption('always', 'Always');
                dropdown.addOption('main', 'Create/rename/delete');
                dropdown.addOption('never', 'Never');

                dropdown.setValue(AutoDefinitionLink.settings.autoRefreshLinks)
                    .onChange(async (value: 'always' | 'main' | 'never') => {
                        AutoDefinitionLink.settings.autoRefreshLinks = value;
                        await this.plugin.saveSettings();
                    });
            });

        // new Setting(containerEl)
        //     .setName('Subfolder depth')
        //     .setDesc('How many subfolders deep to match link destinations; 0 = current folder only; -1 = all subfolders')
        //     .addText((text) => {
        //         text.setValue(AutoDefinitionLink.settings.subFolderDepth.toString())
        //             .onChange(async (value) => {
        //                 AutoDefinitionLink.settings.subFolderDepth = parseInt(value);
        //                 await this.plugin.saveSettings();
        //             });

        //         text.inputEl.type = 'number';
        //         text.inputEl.min = '-1';
        //     });

        new Setting(containerEl)
            .setName('Refresh links')
            .setDesc('Refreshes the links in the current vault. This may take a couple of seconds.')
            .addButton((button) => {
                button.setButtonText('Refresh links')
                    .onClick(async () => {
                        const editor = this.app.workspace.activeEditor?.editor;

                        if (!editor) return;

                        updateBlockIds(this.app, editor);
                    });
            });
    }

}