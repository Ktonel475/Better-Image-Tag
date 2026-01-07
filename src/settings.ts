// settings.ts - UPDATED VERSION
import { App, PluginSettingTab, Setting } from "obsidian";
import QuickTagPlugin from "./main";

export interface QuickTagSettings {
    tags: string[];
    defaultFolder: string;
    autoOpenModal: boolean;
}

export const DEFAULT_SETTINGS: QuickTagSettings = {
    tags: [
        'landscape', 'portrait', 'digital-art', 'traditional',
        'character-design', 'concept-art', 'reference', 'texture',
        'environment', 'illustration', 'sketch', 'painting',
        'photo', 'ui-design', 'icon', 'logo'
    ],
    defaultFolder: 'Image Library',
    autoOpenModal: true
};

export class QuickTagSettingTab extends PluginSettingTab {
    plugin: QuickTagPlugin;

    constructor(app: App, plugin: QuickTagPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'QuickTag Settings' });

        // Default folder setting
        new Setting(containerEl)
            .setName('Default folder')
            .setDesc('Where to save image reference notes')
            .addText(text => text
                .setPlaceholder('Image Library')
                .setValue(this.plugin.settings.defaultFolder)
                .onChange(async (value) => {
                    this.plugin.settings.defaultFolder = value;
                    await this.plugin.saveSettings();
                }));

        // Auto-open modal setting
        new Setting(containerEl)
            .setName('Auto-open notes')
            .setDesc('Automatically open newly created notes')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoOpenModal)
                .onChange(async (value) => {
                    this.plugin.settings.autoOpenModal = value;
                    await this.plugin.saveSettings();
                }));
    }
}