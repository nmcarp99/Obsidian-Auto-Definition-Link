import { App, TFile } from "obsidian";
import { findSuggestionsInText, normalizeId, retrieveAliasesFromContent, retrieveBlockMatchesFromContent } from "./shared";

export function getBackLinks(app: App) {
    return new Promise<TFile[]>((resolveWithBackLinks) => {
        // get ids to match against (active file basename, block matches, and aliases)
        const ids = [app.workspace.activeEditor?.file?.basename || '', // the active file basename
            ...retrieveBlockMatchesFromContent(app.workspace.activeEditor?.editor?.getValue() ?? '') || [], // the active file block ids
            ...retrieveAliasesFromContent(app.workspace.activeEditor?.editor?.getValue() ?? '') || []] // the active file aliases
            .map(normalizeId); // normalize them to match the format used in the suggestions

        const files = app.vault.getMarkdownFiles();

        const fileSearchPromises: Promise<void>[] = [];

        const filesWithSuggestions: TFile[] = [];

        files.forEach(file => {
            if (file === app.workspace.activeEditor?.file) return; // don't search the active file

            fileSearchPromises.push(new Promise(resolve => {
                app.vault.cachedRead(file)
                    .then(contents => {
                        contents.split('\n').forEach(line => {
                            if (filesWithSuggestions.includes(file)) return; // already found a suggestion in this file)

                            if (findSuggestionsInText(line).filter(x => ids.contains(x.suggestion.linkDestination.searchValue)).length) { // filter out suggestions that don't match the active file
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