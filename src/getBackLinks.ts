import { App, TFile } from "obsidian";
import { findSuggestionsInText, normalizeId } from "./shared";

export function getBackLinks(app: App) {
    return new Promise<TFile[]>((resolveWithBackLinks) => {
        const id = normalizeId(app.workspace.activeEditor?.file?.basename || '');

        const files = app.vault.getMarkdownFiles();

        const fileSearchPromises: Promise<void>[] = [];

        const filesWithSuggestions: TFile[] = [];

        files.forEach(file => {
            fileSearchPromises.push(new Promise(resolve => {
                app.vault.cachedRead(file)
                    .then(contents => {
                        contents.split('\n').forEach(line => {
                            if (filesWithSuggestions.includes(file)) return; // already found a suggestion in this file

                            if (findSuggestionsInText(line).filter(x => x.suggestion.linkDestination.searchValue == id).length) { // filter out suggestions that don't match the active file
                                filesWithSuggestions.push(file);
                            }
                        });

                        resolve();
                    });
            }));
        });

        Promise.all(fileSearchPromises).then(() => {
            resolveWithBackLinks(filesWithSuggestions);
        });
    });
}