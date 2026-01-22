import { App, Editor, MarkdownView, Modal, Notice, Plugin, Setting as PluginSettings, PluginSettingTab, ItemView, WorkspaceLeaf, TFile } from 'obsidian';
import { ImageTagSettings, DEFAULT_SETTINGS } from 'settings';

const VIEW_TYPE_TAG_MANAGER = 'tag-manager-view';

class ConfirmationModal extends Modal {
    private resolvePromise: (value: boolean) => void;
    public promise: Promise<boolean>;

    constructor(app: App, message: string, title: string ) {
        super(app);

        this.promise = new Promise((resolve) => {
            this.resolvePromise = resolve;
        });

        this. contentEl.createEl('h2', { text: title });
        this.contentEl.createEl('p', { text: message });

        const buttonContainer = this.contentEl.createDiv({ cls: 'modal-button-container' });

        buttonContainer.createEl('button', { text: 'Cancel' })
            .addEventListener('click', () => {
                this.resolvePromise(false);
                this.close();
            });

        const confirmBtn = buttonContainer.createEl('button', { 
            text: 'Confirm',
            cls: 'mod-cta' // Makes it the primary action button
        });
        confirmBtn.addEventListener('click', () => {
            this.resolvePromise(true);
            this.close();
        });

        // Optional: Close on Escape key
        this.scope.register([], 'Escape', () => {
            this.resolvePromise(false);
            this.close();
            return false;
        });
    }

    onOpen() {
        void super.onOpen();
    }
}

// ==================== MAIN PLUGIN CLASS ====================
export default class ImageTagPlugin extends Plugin {
    settings: ImageTagSettings;
    allTags: string[] = [];

    async onload() {
        await this.loadSettings();
        this.allTags = this.settings.tags;

		const isFirstInstall = this.settings.tags.length === DEFAULT_SETTINGS.tags.length && 
                          JSON.stringify(this.settings.tags) === JSON.stringify(DEFAULT_SETTINGS.tags);
    
		if (isFirstInstall) {        
            // Show notice of scanning existing tags from vault
			new Notice('Scanning your vault for existing tags...');
			
			// Scan for existing tags
			const existingTags = await this.scanForExistingTags();
			
			if (existingTags.length > 0) {
                // Merge with default tags, removing duplicates
				const mergedTags = [...new Set([...DEFAULT_SETTINGS.tags, ...existingTags])];
				this.settings.tags = mergedTags.sort();
				await this.saveSettings();
				this.allTags = this.settings.tags;
				
				new Notice(`ImageTag: Added ${existingTags.length} existing tags from your vault`);
			}
            //Activate Icon on tab by default
            await this.activateTagManagerView();
		}
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				// Check if it's an image file
				if (file instanceof TFile && this.isImageFile(file)) {
					menu.addItem((item) => {
						item
							.setTitle('Image tag')
							.setIcon('tag')
							.onClick(async () => {
								await this.tagImageFile(file);
							});
					});
				}
			})
		);
        // Command: Tag selected image
        this.addCommand({
            id: 'tag-selected-image',
            name: 'Tag selected image',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                const imageName = this.getImageLinkAtCursor(editor);
                
                if (!imageName) {
                    new Notice('No image found. Place cursor on ![[image.jpg]]');
                    return;
                }
                
                new TagModal(this.app, imageName, this.allTags, this.settings.defaultFolder).open();
            }
        });
		this.addCommand({
			id: 'rescan-tags',
			name: 'Rescan vault for existing tags',
			callback: async () => {
				new Notice('Scanning vault for existing tags...');
				const existingTags = await this.scanForExistingTags();
				
				if (existingTags.length > 0) {
					// Merge with current tags
					const mergedTags = [...new Set([...this.settings.tags, ...existingTags])];
					this.settings.tags = mergedTags.sort();
					await this.saveSettings();
					this.allTags = this.settings.tags;
					
					new Notice(`Added ${existingTags.length} tags. Total: ${this.settings.tags.length} tags`);
				} else {
					new Notice('No new tags found in vault');
				}
			}
		});

        // Command: Open tag manager sidebar
        this.addCommand({
            id: 'open-tag-manager-sidebar',
            name: 'Open tag manager sidebar',
            callback: () => {
                this.activateTagManagerView().catch(error => {
                    console.error(error);
                });
            }
        });

        // Register the sidebar view
        this.registerView(
            VIEW_TYPE_TAG_MANAGER,
            (leaf) => new TagManagerSidebarView(leaf, this)
        );

        // Add settings tab
        this.addSettingTab(new ImageTagSettingTab(this.app, this));

        console.debug('ImageTag plugin loaded');
    }

    // Helper to extract image link
    getImageLinkAtCursor(editor: Editor): string | null {
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        
        const match = line.match(/!\[\[([^\]]+\.(?:png|jpg|jpeg|gif|webp|bmp|svg))\]\]/i);
        if (match && match[1]) {
            return match[1];
        }
        return null;
    }

    // Settings management
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<ImageTagSettings>);
    }

    async saveSettings() {
        this.allTags = this.settings.tags; // Update local cache
        await this.saveData(this.settings);
    }

    async addNewTag(tag: string): Promise<boolean> {
        const cleanTag = tag.trim().toLowerCase();
        
        if (!cleanTag) return false;
        if (this.settings.tags.includes(cleanTag)) return false;
        
        this.settings.tags.push(cleanTag);
        await this.saveSettings();
        return true;
    }

    async removeTag(tag: string): Promise<boolean> {
        const index = this.settings.tags.indexOf(tag);
        if (index > -1) {
            this.settings.tags.splice(index, 1);
            await this.saveSettings();
            return true;
        }
        return false;
    }

    async activateTagManagerView() {
        const { workspace } = this.app;

        // Try to find existing tag manager view
        let leaf: WorkspaceLeaf | undefined = workspace.getLeavesOfType(VIEW_TYPE_TAG_MANAGER)[0];
        
        if (!leaf) {
            // Create new leaf in right sidebar
            const newLeaf = workspace.getLeftLeaf(false);
            if (newLeaf) {
                leaf = newLeaf;
                await leaf.setViewState({
                    type: VIEW_TYPE_TAG_MANAGER,
                    active: true,
                });
            } else {
                // Create new tab if no right sidebar
                leaf = workspace.getLeaf(true);
                await leaf.setViewState({
                    type: VIEW_TYPE_TAG_MANAGER,
                    active: true,
                });
            }
        }
        
        // Reveal the leaf if we have one
        if (leaf) {
            workspace.revealLeaf(leaf).catch(error => {
                console.error(error);
            });
        }
    }
	async scanForExistingTags(): Promise<string[]> {
		const foundTags = new Set<string>();
		const files = this.app.vault.getMarkdownFiles();
		
		console.debug(`ImageTag: Scanning ${files.length} files for existing tags...`);
		
		for (const file of files) {
			try {
				const content = await this.app.vault.read(file);
				
				// Find all #tags in the content
				const tagMatches = content.match(/#([a-zA-Z0-9_-]+)/g);
				if (tagMatches) {
					tagMatches.forEach(tagMatch => {
						// Remove the # symbol and clean the tag
						const cleanTag = tagMatch.substring(1).toLowerCase().trim();
						if (cleanTag && cleanTag.length > 1) { // Skip single character tags
							foundTags.add(cleanTag);
						}
					});
				}
				
				// Also check frontmatter tags
				const frontmatterMatch = content.match(/tags:\s*\[([\s\S]*?)\]/);
				if (frontmatterMatch) {
					const tagsString = frontmatterMatch?.[1];
					if (!tagsString) continue;
					const tags = tagsString.split(',').map(tag => 
						tag.trim().replace(/["']/g, '').toLowerCase()
					).filter(tag => tag.length > 1);
					
					tags.forEach(tag => foundTags.add(tag));
				}
			} catch (error) {
				console.error(`ImageTag: Error reading ${file.path}:`, error);
			}
		}
		
		const uniqueTags = Array.from(foundTags);
		console.debug(`ImageTag: Found ${uniqueTags.length} unique tags in vault`);
		return uniqueTags;
	}
	// Helper: Check if file is an image
	private isImageFile(file: TFile): boolean {
		const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
		return imageExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
	}

	// Helper: Tag image file from context menu
	private async tagImageFile(file: TFile) {
		// Show tag modal
		new TagModal(
			this.app, 
			file.name, 
			this.allTags, 
			this.settings.defaultFolder
		).open();
	}

    onunload() {
        console.debug('ImageTag plugin unloaded');
    }
}

// ==================== TAG SELECTION MODAL ====================
class TagModal extends Modal {
    selectedTags: Set<string> = new Set();
    allTags: string[];
    imageName: string;
    defaultFolder: string;
    author: string = '';
    noteContent: string = '';

    constructor(app: App, imageName: string, allTags: string[], defaultFolder: string) {
        super(app);
        this.imageName = imageName;
        this.allTags = allTags;
        this.defaultFolder = defaultFolder;
    }

    onOpen() {
        const {contentEl} = this;
        contentEl.empty();
        
        // Header
        const fileName = this.imageName.split('/').pop() || this.imageName;
        contentEl.createEl('h2', { text: `Tag: ${fileName}` });
        
        // Tag selection area
        contentEl.createEl('p', { 
            text: 'Click tags to select (selected tags will be highlighted):',
            cls: 'tag-instruction'
        });
        
        const tagsContainer = contentEl.createDiv('ImageTag-tags-container');
        
        // Display all tags as clickable buttons
        this.allTags.forEach(tag => {
            const btn = tagsContainer.createEl('button', {
                text: tag,
                cls: 'ImageTag-tag-btn'
            });
            
            if (this.selectedTags.has(tag)) {
                btn.addClass('ImageTag-tag-selected');
            }
            
            btn.addEventListener('click', () => {
                if (this.selectedTags.has(tag)) {
                    this.selectedTags.delete(tag);
                    btn.removeClass('ImageTag-tag-selected');
                } else {
                    this.selectedTags.add(tag);
                    btn.addClass('ImageTag-tag-selected');
                }
            });
        });

        // Author input
        new PluginSettings(contentEl)
            .setName('Author (optional)')
            .setDesc('Who created this image?')
            .addText(text => text
                .setPlaceholder('E.g. ,author name, studio name')
                .setValue(this.author)
                .onChange(value => this.author = value));

        // Note content
        new PluginSettings(contentEl)
            .setName('Notes (optional)')
            .setDesc('Add any observations or thoughts')
            .addTextArea(text => text
                .setPlaceholder('What do you like about this image? How might you use it?')
                .setValue(this.noteContent)
                .onChange(value => this.noteContent = value));

        // Action buttons
        const buttonContainer = contentEl.createDiv('ImageTag-button-container');
        
        new PluginSettings(buttonContainer)
            .addButton(btn => btn
                .setButtonText('Create note')
                .setCta()
                .onClick(() => this.createNote()))
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => this.close()));
    }

    async createNote() {
        const tagsArray = Array.from(this.selectedTags);
        
        // Create frontmatter
        const frontmatter = `---
image: "${this.imageName}"
author: "${this.author}"
tags: [${tagsArray.map(t => `"${t}"`).join(', ')}]
created: "${new Date().toISOString().split('T')[0]}"
---`;

        // Create note body
        const body = `![[${this.imageName}|600]]

${this.noteContent ? `## Notes\n\n${this.noteContent}` : ''}`;

        const fullContent = `${frontmatter}\n\n${body}`;

        // Determine folder path
        const folderPath = this.defaultFolder;
        const safeImageName = this.imageName.replace(/[<>:"/\\|?*]/g, '_');
        const baseName = safeImageName.replace(/\.[^/.]+$/, '');
        const fileName = `${baseName}.md`;
        const fullPath = folderPath ? `${folderPath}/${fileName}` : fileName;

        try {
            // Ensure folder exists
            if (folderPath) {
                // @ts-ignore - internal API
                const folderExists = await this.app.vault.adapter.exists(folderPath);
                if (!folderExists) {
                    // @ts-ignore
                    await this.app.vault.adapter.mkdir(folderPath);
                }
            }

            // Create the note
            await this.app.vault.create(fullPath, fullContent);
            
            // Open the note if setting is enabled
            //@ts-ignore
             // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            if (this.app.plugins.plugins?.ImageTag?.settings?.autoOpenModal) {
                const leaf = this.app.workspace.getLeaf();
                const file = this.app.vault.getAbstractFileByPath(fullPath);
                if (file) {
                    // @ts-ignore
                    await leaf.openFile(file);
                }
            }
            
            new Notice(`Created: ${fileName}`);
        } catch (error) {
            console.error('Error creating note:', error);
            new Notice('Failed to create note');
        }

        this.close();
    }

    onClose() {
        const {contentEl} = this;
        contentEl.empty();
    }
}

// ==================== SIDEBAR TAG MANAGER ====================
class TagManagerView {
    plugin: ImageTagPlugin;
    containerEl: HTMLElement;
    tagInputEl: HTMLInputElement;

    private sortButtons?: {
        nameBtn: HTMLButtonElement;
        countBtn: HTMLButtonElement;
    };

    constructor(plugin: ImageTagPlugin, containerEl: HTMLElement) {
        this.plugin = plugin;
        this.containerEl = containerEl;
        this.render();
    }

    render() {
        this.containerEl.empty();
        
        // Header
        this.containerEl.createEl('h3', { text: 'Tag manager' });
        
        // Stats
        const tagCount = this.plugin.settings.tags.length;
        this.containerEl.createEl('p', {
            text: `${tagCount} tags in your collection`,
            cls: 'tag-manager-stats'
        });

        // Render element
        this.renderSearchAndSort();
        this.renderTagsList();
        this.renderAddTagSection();        
    }

    renderTagsList() {
        const tagsContainer = this.containerEl.createDiv('tag-manager-list');
        tagsContainer.id = 'tag-manager-list';
        
        // Get all files and their metadata
        const files = this.plugin.app.vault.getMarkdownFiles();
        const tagCounts: Record<string, number> = {};
        
        files.forEach(file => {
            const cache = this.plugin.app.metadataCache.getFileCache(file);
            if (cache?.tags) {
                cache.tags.forEach(tagInfo => {
                    const tag = tagInfo.tag.substring(1); // Remove the # prefix
                    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                });
            }
            
            // Also check frontmatter tags
            if (cache?.frontmatter?.tags) {
                const tags = Array.isArray(cache.frontmatter.tags) 
                    ? cache.frontmatter.tags 
                    : [cache.frontmatter.tags];
                
                tags.forEach(tag => {
                    const cleanTag = typeof tag === 'string' ? tag : String(tag);
                    tagCounts[cleanTag] = (tagCounts[cleanTag] || 0) + 1;
                });
            }
        });
        
        // Display tags from settings with their counts
        this.plugin.settings.tags.forEach(tag => {
            const count = tagCounts[tag] || 0;
            this.createTagItem(tag, count, tagsContainer);
        });
    }

    createTagItem(tag: string, tagCount: number, container: HTMLElement) {
        const tagItem = container.createDiv('tag-manager-item');
        
        // Tag name container
        const tagContent = tagItem.createDiv('tag-content');

        const countBadge = tagContent.createEl('span', {
            text: tagCount.toString(),
            cls: 'tag-count'
        });
        
        // Tag name
        const tagName = tagContent.createEl('span', {
            text: tag,
            cls: 'tag-name'
        });
        
        tagContent.addEventListener('click', () => {
            // Copy tag to clipboard for easy use
            navigator.clipboard.writeText(tag).catch(error => {
                console.error(error);
            });
            new Notice(`Copied: ${tag}`);
        });

        // Delete button
        const deleteBtn = tagItem.createEl('button', {
            text: '×',
            cls: 'tag-delete-btn',
            title: 'Delete tag'
        });

        deleteBtn.addEventListener('click', (e) => {
            // Prevent triggering the copy function
            e.stopPropagation(); 
            const pluginInstance = this.plugin;
            void (async () => {
                let confirmed = false;
                if (tagCount > 0) {
                    // Show warning for tags that are in use
                    confirmed = await this.showDeleteWarning(tag, tagCount);
                } else {
                    const modal = new ConfirmationModal(pluginInstance.app, `Delete tag "${tag}"?`, "Warning ");
                    modal.open();
                    confirmed = await modal.promise; 
                }
                if (confirmed) {
                    await this.handleTagDeletion(tag);
                    new Notice(`Deleted tag "${tag}"`);
                }
            })().catch(error => {
                console.error("Failed to delete tag", error);
                new Notice('Failed to delete tag');
            });
        });
        
        return tagItem;
    }

    renderAddTagSection() {
        const addSection = this.containerEl.createDiv('tag-add-section');
        
        const inputRow = addSection.createDiv('tag-input-row');
        this.tagInputEl = inputRow.createEl('input', {
            type: 'text',
            placeholder: 'New tag name...',
            cls: 'tag-add-input'
        });
        
        const addBtn = inputRow.createEl('button', {
            text: 'Add',
            cls: 'tag-add-btn'
        });
        
        addBtn.addEventListener('click', () => 
            void this.addNewTag()
                .catch(error => {
                    console.error("Fail to add new tag: ", error);
                }));
        
        this.tagInputEl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                void this.addNewTag();
            }
        });
    }
    async DeleteTag(tag: string) {
        const tagsList = this.containerEl.querySelector('#tag-manager-list');
        if (!tagsList) return;

        const tagItems = tagsList.querySelectorAll('.tag-manager-item');
        tagItems.forEach (item =>{
            const tagName = item.querySelector('.tag-name')?.textContent;
            if (tagName === tag) {
                item.remove();
            }
        })

        this.updateStats();
    }

    async addNewTag() {
        const newTag = this.tagInputEl.value.trim().toLowerCase();
        
        if (!newTag) {
            new Notice('Please enter a tag name');
            return;
        }
        
        const success = await this.plugin.addNewTag(newTag);
        if (success) {
            // Add to the list
            const tagsList = this.containerEl.querySelector('#tag-manager-list');
            if (tagsList) {
                this.createTagItem(newTag, 0, tagsList as HTMLElement);
            }
            
            this.tagInputEl.value = '';
            this.updateStats();
            new Notice(`Added tag: ${newTag}`);
        } else {
            new Notice('Tag already exists');
        }
    }

    filterTags(searchTerm: string) {
        const tagsList = this.containerEl.querySelector('#tag-manager-list');
        if (!tagsList) return;
        
        const tagItems = tagsList.querySelectorAll('.tag-manager-item');
        const searchLower = searchTerm.toLowerCase();
        
        tagItems.forEach(item => {
            const tagName = item.querySelector('.tag-name')?.textContent?.toLowerCase() || '';
            const isVisible = tagName.includes(searchLower);
            (item as HTMLElement).style.display = isVisible ? 'flex' : 'none';
        });
    }

    updateStats() {
        const stats = this.containerEl.querySelector('.tag-manager-stats');
        if (stats) {
            stats.textContent = `${this.plugin.settings.tags.length} tags in your collection`;
        }
    }

    sortTags(sortBy: 'name' | 'count' | 'relevance', searchTerm?: string) {
        const tagsList = this.containerEl.querySelector('#tag-manager-list');
        if (!tagsList) return;
        
        const tagItems = Array.from(tagsList.querySelectorAll('.tag-manager-item'));
        
        switch (sortBy) {
            case 'name':
                this.sortByName(tagItems);
                break;
            case 'count':
                this.sortByCount(tagItems);
                break;
            case 'relevance':
                if (searchTerm) {
                    this.sortByRelevance(searchTerm, tagItems);
                } else {
                    this.sortByName(tagItems);
                }
                break;
        }
        
        // Reattach in sorted order
        this.reorderTagItems(tagItems);
    }

    renderSearchAndSort() {
        const searchSortContainer = this.containerEl.createDiv('tag-search-sort-container');
        
        // Search input
        const searchInput = searchSortContainer.createEl('input', {
            type: 'text',
            placeholder: 'Search tags...',
            cls: 'tag-search-input'
        });
        
        // Sort button (triggers dropdown)
        const sortButton = searchSortContainer.createEl('button', {
            text: 'Sort by count',
            cls: 'tag-sort-btn'
        });
        
        // Floating dropdown overlay
        const dropdown = searchSortContainer.createDiv('tag-sort-dropdown');
        
        const sortOptions = [
            { id: 'count', text: 'Count', icon: '↓', label: 'Sort by Count' },
            { id: 'name', text: 'Name A-Z', icon: 'A-Z', label: 'Sort by Name A-Z' },
            { id: 'relevance', text: 'Relevance', icon: '★', label: 'Sort by Relevance' }
        ];
        
        sortOptions.forEach(option => {
            const item = dropdown.createDiv('tag-sort-item');
            item.setAttribute('data-sort', option.id);
            
            item.createEl('span', { 
                text: option.icon, 
                cls: 'sort-icon' 
            });
            item.createEl('span', { 
                text: option.text, 
                cls: 'sort-text' 
            });
            
            item.addEventListener('click', () => {
                const searchTerm = searchInput.value.trim();
                
                // Update button text
                sortButton.textContent = option.label;
                
                // Perform sort
                if (option.id === 'relevance' && !searchTerm) {
                    this.sortTags('count');
                    sortButton.textContent = 'Sort by count';
                } else if (option.id === 'relevance') {
                    this.sortTags('relevance', searchTerm);
                } else {
                    this.sortTags(option.id as 'name' | 'count');
                }
                
                // Close dropdown
                dropdown.classList.remove('active');
            });
        });
        
        // Toggle dropdown
        sortButton.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('active');
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!searchSortContainer.contains(e.target as Node)) {
                dropdown.classList.remove('active');
            }
        });
        
        // Search functionality
        searchInput.addEventListener('input', () => {
            const searchTerm = searchInput.value.trim();
            this.filterTags(searchTerm);
            
            if (searchTerm) {
                this.sortTags('relevance', searchTerm);
                sortButton.textContent = 'Sort by relevance';
            }
        });
    }

    private async showDeleteWarning(tag: string, usageCount: number): Promise<boolean> {
        return new Promise((resolve) => {
            // Create custom modal for better UX
            const modal = new Modal(this.plugin.app);
            modal.titleEl.setText('Delete tag warning');
            
            const content = modal.contentEl;
            content.createEl('p', {
                text: `This tag is used in ${usageCount} file${usageCount > 1 ? 's' : ''}.`,
                cls: 'tag-delete-warning-text'
            });
            
            content.createEl('p', {
                text: `Deleting "${tag}" will remove it from all files.`,
                cls: 'tag-delete-warning-text'
            });
            
            content.createEl('p', {
                text: 'This action cannot be undone.',
                cls: 'tag-delete-warning-danger'
            });
            
            // Warning actions
            const buttonContainer = content.createDiv('tag-delete-warning-buttons');
            
            const cancelBtn = buttonContainer.createEl('button', {
                text: 'Cancel',
                cls: 'tag-delete-cancel-btn'
            });
            cancelBtn.addEventListener('click', () => {
                modal.close();
                resolve(false);
            });
            
            const confirmBtn = buttonContainer.createEl('button', {
                text: `Delete from ${usageCount} file${usageCount > 1 ? 's' : ''}`,
                cls: 'tag-delete-confirm-btn'
            });
            confirmBtn.addEventListener('click', () => {
                modal.close();
                resolve(true);
            });
            
            modal.open();
        });
    }

    private async handleTagDeletion(tag: string): Promise<void> {
        try {
            // Remove tag from plugin settings
            const removed = await this.plugin.removeTag(tag);
            
            if (removed) {
                // Remove tag from all markdown files
                await this.removeTagFromAllFiles(tag).catch(error => {
                    console.error("Tag Removal Error", error)
                });
                
               await this.DeleteTag(tag).catch(error => {
                    console.error("Tag Deletion Error:", error);
               });
                
                // Update stats
                this.updateStats();
                
                new Notice(`Deleted tag "${tag}" from all files`);
            }
        } catch (error) {
            console.error('Error deleting tag:', error);
            new Notice(`Failed to delete tag "${tag}"`);
        }
    }

    private async removeTagFromAllFiles(tag: string): Promise<void> {
        const files = this.plugin.app.vault.getMarkdownFiles();
        let updatedFiles = 0;
        
        for (const file of files) {
            try {
                let content = await this.plugin.app.vault.read(file);
                let modified = false;
                
                // Remove inline #tag references
                const regex = new RegExp(`#${tag}\\b`, 'g');
                const newContent = content.replace(regex, '');
                if (newContent !== content) {
                    content = newContent;
                    modified = true;
                }
                
                // Remove from frontmatter tags array
                const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
                if (frontmatterMatch?.[1]) {
                    const frontmatter = frontmatterMatch[1];
                    const lines = frontmatter.split('\n');
                    const newLines = [];
                    
                    for (const line of lines) {
                        if (line.startsWith('tags:')) {
                            // Parse tags array
                            const tagsMatch = line.match(/tags:\s*\[(.*)\]/);
                            if (tagsMatch) {
                                const tagsStr = tagsMatch[1];
                                if (!tagsStr) continue;
                                const tagsArray = tagsStr.split(',')
                                    .map(t => t.trim().replace(/["']/g, ''))
                                    .filter(t => t !== tag);
                                
                                if (tagsArray.length > 0) {
                                    const newTags = tagsArray.map(t => `"${t}"`).join(', ');
                                    newLines.push(`tags: [${newTags}]`);
                                } else {
                                    newLines.push('tags: []');
                                }
                                modified = true;
                            } else {
                                newLines.push(line);
                            }
                        } else {
                            newLines.push(line);
                        }
                    }
                    
                    if (modified) {
                        const newFrontmatter = newLines.join('\n');
                        content = content.replace(frontmatterMatch[0], `---\n${newFrontmatter}\n---`);
                    }
                }
                
                if (modified) {
                    await this.plugin.app.vault.modify(file, content);
                    updatedFiles++;
                }
                
            } catch (error) {
                console.error(`Error updating file ${file.path}:`, error);
            }
        }
        
        console.debug(`Removed tag "${tag}" from ${updatedFiles} files`);
    }

    // Sort alphabetically (A-Z)
    private sortByName(tagItems: Element[]) {
        tagItems.sort((a, b) => {
            const aName = a.querySelector('.tag-name')?.textContent || '';
            const bName = b.querySelector('.tag-name')?.textContent || '';
            return aName.localeCompare(bName, undefined, { numeric: true });
        });
    }

    // Sort by count (descending), then alphabetically
    private sortByCount(tagItems: Element[]) {
        tagItems.sort((a, b) => {
            const aCountText = a.querySelector('.tag-count')?.textContent || '0';
            const bCountText = b.querySelector('.tag-count')?.textContent || '0';
            const aCount = parseInt(aCountText);
            const bCount = parseInt(bCountText);
            
            if (bCount !== aCount) return bCount - aCount;
            
            const aName = a.querySelector('.tag-name')?.textContent || '';
            const bName = b.querySelector('.tag-name')?.textContent || '';
            return aName.localeCompare(bName);
        });
    }

    // Sort by relevance to search term
    private sortByRelevance(searchTerm: string, tagItems: Element[]) {
        const searchLower = searchTerm.toLowerCase();
        
        tagItems.sort((a, b) => {
            const aName = a.querySelector('.tag-name')?.textContent?.toLowerCase() || '';
            const bName = b.querySelector('.tag-name')?.textContent?.toLowerCase() || '';
            const aCountText = a.querySelector('.tag-count')?.textContent || '0';
            const bCountText = b.querySelector('.tag-count')?.textContent || '0';
            const aCount = parseInt(aCountText);
            const bCount = parseInt(bCountText);
            
            // Calculate relevance scores
            const aScore = this.calculateRelevanceScore(aName, searchLower, aCount);
            const bScore = this.calculateRelevanceScore(bName, searchLower, bCount);
            
            if (bScore !== aScore) return bScore - aScore;
            if (bCount !== aCount) return bCount - aCount;
            return aName.localeCompare(bName);
        });
    }

    // Calculate relevance score for a tag
    private calculateRelevanceScore(tagName: string, searchTerm: string, count: number): number {
        let score = 0;
        
        // Exact match gets highest priority
        if (tagName === searchTerm) score += 1000;
        
        // Starts with search term
        else if (tagName.startsWith(searchTerm)) score += 100;
        
        // Contains search term anywhere
        else if (tagName.includes(searchTerm)) score += 10;
        
        // Boost by usage count (but less than search relevance)
        score += Math.min(count, 5);
        
        return score;
    }

    // Reorder items in the DOM
    private reorderTagItems(tagItems: Element[]) {
        const tagsList = this.containerEl.querySelector('#tag-manager-list');
        if (!tagsList) return;
        
        // Clear and re-add in sorted order
        tagsList.innerHTML = '';
        tagItems.forEach(item => {
            if ((item as HTMLElement).style.display !== 'none') {
                tagsList.appendChild(item);
            }
        });
    }
}

// ==================== TAG MANAGER SIDEBAR VIEW ====================
class TagManagerSidebarView extends ItemView {
    plugin: ImageTagPlugin;
    tagManager: TagManagerView | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: ImageTagPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_TAG_MANAGER;
    }

    getDisplayText(): string {
        return 'Tag manager';
    }

    getIcon(): string {
        return 'tags';
    }

    async onOpen() {
        const { containerEl } = this;
        
        // Clear any existing content
        containerEl.empty();
        
        // Add a container with proper class
        const contentEl = containerEl.createDiv('tag-manager-container');
        
        // Initialize the tag manager
        this.tagManager = new TagManagerView(this.plugin, contentEl);
    }

    async onClose() {
        // Cleanup
        this.tagManager = null;
    }
}

// ==================== SETTINGS TAB ====================
class ImageTagSettingTab extends PluginSettingTab {
    plugin: ImageTagPlugin;

    constructor(app: App, plugin: ImageTagPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
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

        // Tag manager section
        new PluginSettings(containerEl).setName("Tag management").setHeading();
        containerEl.createEl('p', { 
            text: 'Open the sidebar tag manager to add, remove, or edit tags.',
            cls: 'setting-description'
        });

        // Open sidebar button
        new PluginSettings(containerEl)
            .setName('Tag manager sidebar')
            .setDesc('Open the tag manager in the sidebar')
            .addButton(btn => btn
                .setButtonText('Open sidebar')
                .setCta()
                .onClick(() => {
                    this.plugin.activateTagManagerView().catch(error => {
                            console.error('Failed to open tag manager:', error);
                            // Show notice to user
                            new Notice('Failed to open tag manager');
                        });
                }));
		// Tag scanning section
		new PluginSettings(containerEl)
			.setName('Scan vault for tags')
			.setDesc('Find all existing #tags in your vault and add them to the tag manager')
			.addButton(btn => btn
				.setButtonText('Scan now')
				.onClick(async () => {
                    const modal = new ConfirmationModal(this.app, 'This may take a few moments.', 'Scan your entire vault for existing tags? ');
                    modal.open();
					let confirmed =  false
                    confirmed = await modal.promise;
					if (confirmed) {
						const existingTags = await this.plugin.scanForExistingTags();
						
						if (existingTags.length > 0) {
							// Ask user if they want to merge or replace
                            const modal = new ConfirmationModal(this.app, 'Merge with existing tags? (Cancel to replace all tags)', `Found ${existingTags.length} tags. `);
							modal.open();
                            let merge = false;
                            merge= await modal.promise;                            
							
							if (merge) {
								// Merge
								const mergedTags = [...new Set([...this.plugin.settings.tags, ...existingTags])];
								this.plugin.settings.tags = mergedTags.sort();
							} else {
								// Replace
								this.plugin.settings.tags = existingTags.sort();
							}
							
							await this.plugin.saveSettings();
							new Notice(`Updated tags. Total: ${this.plugin.settings.tags.length} tags`);
						} else {
							new Notice('No tags found in vault');
						}
					}
        }));
        // Reset to defaults
        new PluginSettings(containerEl)
            .setName('Reset to defaults')
            .setDesc('Reset all settings and tags to default values')
            .addButton(btn => btn
                .setButtonText('Reset')
                .setWarning()
                .onClick(async () => {
                    this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
                    await this.plugin.saveSettings();
                    this.display(); // Refresh
                    new Notice('Settings reset to defaults');
                }));
    }
}