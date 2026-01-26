// settings.ts - UPDATED VERSION
import { App, PluginSettingTab, Setting as PluginSettings } from "obsidian";
import ImageTagPlugin from "./main";

export interface ImageTagSettings {
    tags: string[];
    defaultFolder: string;
    autoOpenModal: boolean;
}

export const DEFAULT_SETTINGS: ImageTagSettings = {
    tags: [
        'Sample Tag A', 'Sample Tag B'      
    ],
    defaultFolder: 'Image Library',
    autoOpenModal: true
};

export class ImageTagSettingTab extends PluginSettingTab {
    plugin: ImageTagPlugin;

    constructor(app: App, plugin: ImageTagPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new PluginSettings(containerEl).setName("Image tag settings").setHeading();

        // Default folder setting
        new PluginSettings(containerEl)
            .setName('Default folder')
            .setDesc('Where to save image reference notes')
            .addText(text => text
                .setPlaceholder('Image library')
                .setValue(this.plugin.settings.defaultFolder)
                .onChange(async (value) => {
                    this.plugin.settings.defaultFolder = value;
                    await this.plugin.saveSettings();
                }));

        // Auto-open modal setting
        new PluginSettings(containerEl)
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