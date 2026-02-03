import { App, Editor, MarkdownView, Modal, Notice, Plugin, Setting as PluginSettings, PluginSettingTab, ItemView, WorkspaceLeaf, TFile } from 'obsidian'
import { ImageTagSettings, DEFAULT_SETTINGS } from 'settings'

const VIEW_TYPE_TAG_MANAGER = 'tag-manager-view'

// ==================== MAIN PLUGIN CLASS =======================
export default class ImageTagPlugin extends Plugin {
    settings: ImageTagSettings
    allTags: string[] = []
    tab: TagManagerView

    async onload() {
        await this.loadSettings()
        this.allTags = this.settings.tags

		const isFirstInstall = this.settings.tags.length === DEFAULT_SETTINGS.tags.length && 
                          JSON.stringify(this.settings.tags) === JSON.stringify(DEFAULT_SETTINGS.tags)
        this.app.workspace.onLayoutReady(async () => {
            if (isFirstInstall) {        
                // Show notice of scanning existing tags from vault
                //Activate Icon on tab by default
                const modal = new WelcomeModal(this.app, this)
                modal.open()
                await this.activateTagManagerView()
            }
        })
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				// Check if it's an image file
				if (file instanceof TFile && this.isImageFile(file)) {
					menu.addItem((item) => {
						item
							.setTitle('Image tag')
							.setIcon('tag')
							.onClick(async () => {
								await this.tagImageFile(file)
							})
					})
				}
			})
		)
        // Command: Tag selected image
        this.addCommand({
            id: 'tag-selected-image',
            name: 'Tag selected image',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                const imageName = this.getImageLinkAtCursor(editor)
                
                if (!imageName) {
                    new Notice('No image found. Place cursor on ![[image.jpg]]')
                    return
                }
                
                new NoteAddingModal(this.app, imageName, this.allTags, this.settings.defaultFolder).open()
            }
        })

        // Command: Open tag manager sidebar
        this.addCommand({
            id: 'open-tag-manager-sidebar',
            name: 'Open tag manager sidebar',
            callback: () => {
                this.activateTagManagerView().catch(error => {
                    console.error(error)
                })
            }
        })

        // Register the sidebar view
        this.registerView(
            VIEW_TYPE_TAG_MANAGER,
            (leaf) => new RenderElement(leaf, this)
        )

        // Add settings tab
        this.addSettingTab(new ImageTagSettingTab(this.app, this))

        console.debug('ImageTag plugin loaded')
    }

    // Helper to extract image link
    getImageLinkAtCursor(editor: Editor): string | null {
        const cursor = editor.getCursor()
        const line = editor.getLine(cursor.line)
        
        const match = line.match(/!\[\[([^\]]+\.(?:png|jpg|jpeg|gif|webp|bmp|svg))\]\]/i)
        if (match && match[1]) {
            return match[1]
        }
        return null
    }

    // Settings management
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<ImageTagSettings>)
    }

    async saveSettings() {
        this.allTags = this.settings.tags 
        await this.saveData(this.settings)
    }

    async addNewTag(tag: string): Promise<boolean> {
        const cleanTag = tag.trim().toLowerCase()
        
        if (!cleanTag) return false
        if (this.settings.tags.includes(cleanTag)) return false
        
        this.settings.tags.push(cleanTag)
        await this.saveSettings()
        return true
    }

    async removeTag(tag: string): Promise<boolean> {
        const index = this.settings.tags.indexOf(tag)
        if (index > -1) {
            this.settings.tags.splice(index, 1)
            await this.saveSettings()
            return true
        }
        return false
    }

    async activateTagManagerView() {
        const { workspace } = this.app

        // Try to find existing tag manager view
        let leaf: WorkspaceLeaf | undefined = workspace.getLeavesOfType(VIEW_TYPE_TAG_MANAGER)[0]
        
        if (!leaf) {
            // Create new leaf in right sidebar
            const newLeaf = workspace.getLeftLeaf(false)
            if (newLeaf) {
                leaf = newLeaf
                await leaf.setViewState({
                    type: VIEW_TYPE_TAG_MANAGER,
                    active: true,
                })
            } else {
                // Create new tab if no right sidebar
                leaf = workspace.getLeaf(true)
                await leaf.setViewState({
                    type: VIEW_TYPE_TAG_MANAGER,
                    active: true,
                })
            }
        }
        
        // Reveal the leaf if we have one
        if (leaf) {
            workspace.revealLeaf(leaf).catch(error => {
                console.error(error)
            })
        }
    }
	async scanForExistingTags(): Promise<string[]> {
		const foundTags = new Set<string>()
		const files = this.app.vault.getMarkdownFiles()
		
		console.debug(`ImageTag: Scanning ${files.length} files for existing tags...`)
		
		for (const file of files) {
			try {
				const content = await this.app.vault.read(file)
				
				// Find all #tags in the content
				const tagMatches = content.match(/(?:#|-\s)([a-zA-Z0-9_-]+)/g)
				if (tagMatches) {
                    tagMatches.forEach(tagMatch => {
                        const cleanTag = tagMatch.replace(/^(?:#|-\s)/, '').toLowerCase().trim()
                        
                        if (cleanTag && cleanTag.length > 1) { // Skip single character tags
                            foundTags.add(cleanTag)
                        }
                    })
                }
				
				// Also check frontmatter tags
				const frontmatterMatch = content.match(/tags:\s*\[([\s\S]*?)\]/)
				if (frontmatterMatch) {
					const tagsString = frontmatterMatch?.[1]
					if (!tagsString) continue
					const tags = tagsString.split(',').map(tag => 
						tag.trim().replace(/["']/g, '').toLowerCase()
					).filter(tag => tag.length > 1)
					
					tags.forEach(tag => foundTags.add(tag))
				}
			} catch (error) {
				console.error(`ImageTag: Error reading ${file.path}:`, error)
			}
		}
		const allFoundTags = Array.from(foundTags)
    
        // Get current tags from settings
        const currentTags = this.settings.tags || []
        
        // Compare to find new and existing tags
        const newTags = allFoundTags.filter(tag => !currentTags.includes(tag))

         if (newTags.length > 0) {
            
           new Notice ('Please restart Obsidian to refresh tag list')
        }

        if (newTags.length > 0) {
            // Ask user if they want to merge or replace
            const modal = new ConfirmationModal(this.app, 'Merge with existing tags? (Cancel to replace all tags)', `Found ${newTags.length} tags. `)
            modal.open()
            let merge = false
            merge= await modal.promise                            
            
            if (merge) {
                // Merge
                const mergedTags = [...new Set([...DEFAULT_SETTINGS.tags, ...newTags])]
                this.settings.tags = mergedTags.sort()
                await this.saveSettings()
                this.allTags = this.settings.tags                            
            }
            
            await this.saveSettings()
            new Notice(`Updated tags. Total: ${this.settings.tags.length} tags`)
            new Notice ('Please restart Obsidian to take effect')
        } else {
            new Notice('No tags found in vault')
        }

		return newTags
	}
	// Helper: Check if file is an image
	private isImageFile(file: TFile): boolean {
		const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']
		return imageExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
	}

	// Helper: Tag image file from context menu
	private async tagImageFile(file: TFile) {
		// Show tag modal
		new NoteAddingModal(
			this.app, 
			file.name, 
			this.allTags, 
			this.settings.defaultFolder
		).open()
	}

    onunload() {
        console.debug('ImageTag plugin unloaded')
    }

     public async showCriticalWarning(title: string, warnInfo: {txt: string, txt1?: string, txt2?: string}, confirmbtn: string): Promise<boolean> {
        return new Promise((resolve) => {
            // Create custom modal for better UX
            const modal = new Modal(this.app)
            modal.titleEl.setText(title)
            
            const content = modal.contentEl
            content.createEl('p', {
                text: warnInfo.txt,
                cls: 'tag-delete-warning-text'
            })

            if (warnInfo.txt1){
                content.createEl('p', {
                    text:  warnInfo.txt1,
                    cls: 'tag-delete-warning-text'
                })
            }
            if (warnInfo.txt2){   
                content.createEl('p', {
                    text: warnInfo.txt2,
                    cls: 'tag-delete-warning-danger'
                })
            }
            
            // Warning actions
            const btnContainer = content.createDiv('modal-button-container')
            
            const cancelBtn = btnContainer.createEl('button', {
                text: 'Cancel',
                cls: 'tag-delete-cancel-btn'
            })
            cancelBtn.addEventListener('click', () => {
                modal.close()
                resolve(false)
            })
            
            const confirmBtn = btnContainer.createEl('button', {
                text:  confirmbtn,
                cls: 'tag-delete-confirm-btn'
            })
            confirmBtn.addEventListener('click', () => {
                modal.close()
                resolve(true)
            })
            
            modal.open()
        })
    }
}

// ==================== SIDEBAR CONSTRUCTOR====================
class RenderElement extends ItemView {
    plugin: ImageTagPlugin
    tagManager: TagManagerView | null = null

    constructor(leaf: WorkspaceLeaf, plugin: ImageTagPlugin) {
        super(leaf)
        this.plugin = plugin
    }

    getViewType(): string {
        return VIEW_TYPE_TAG_MANAGER
    }

    getDisplayText(): string {
        return 'Tag manager'
    }

    getIcon(): string {
        return 'tags'
    }

    async onOpen() {
        const { containerEl } = this
        
        // Clear any existing content
        containerEl.empty()
        
        // Add a container with proper class
        const contentEl = containerEl.createDiv('tag-manager-container')
        
        // Initialize the tag manager
        this.tagManager = new TagManagerView(this.plugin, contentEl)
    }

    async onClose() {
        // Cleanup
        this.tagManager = null
    }
}

// ==================== SIDEBAR TAG MANAGER ====================
class TagManagerView {
    plugin: ImageTagPlugin
    handle: TagAddingModal
    containerEl: HTMLElement
    tagInputEl: HTMLInputElement
    

    constructor(plugin: ImageTagPlugin, containerEl: HTMLElement) {
        this.plugin = plugin
        this.containerEl = containerEl

        this.handle = new TagAddingModal(this.plugin.app)
        this.handle.plugin = this.plugin
        this.handle.tab = this


        this.render()
    }

    render() {
        this.containerEl.empty()
        
        // Header
        this.containerEl.createEl('h3', { text: 'Tag manager' })
        
        // Stats
        const tagCount = this.plugin.settings.tags.length
        this.containerEl.createEl('p', {
            text: `${tagCount} tags in your collection`,
            cls: 'tag-manager-stats'
        })

        // Render element
        this.renderSearchAndSort()
        this.renderTagsList()  
    }

  renderTagsList() {
    let tagsContainer = this.containerEl.querySelector('#tag-manager-list')

    if (!tagsContainer) {
        tagsContainer = this.containerEl.createDiv('tag-manager-list')
        tagsContainer.id = 'tag-manager-list'
    }
    
    // Get all files and their metadata
    const files = this.plugin.app.vault.getMarkdownFiles()
    const tagCounts: Record<string, number> = {}
    
    files.forEach(file => {
        const cache = this.plugin.app.metadataCache.getFileCache(file)
        if (cache?.tags) {
            cache.tags.forEach(tagInfo => {
                const tag = tagInfo.tag.substring(1)
                tagCounts[tag] = (tagCounts[tag] || 0) + 1
            })
        }
        
        // Also check frontmatter tags
        if (cache?.frontmatter?.tags) {
            const tags = Array.isArray(cache.frontmatter.tags) 
                ? cache.frontmatter.tags 
                : [cache.frontmatter.tags]
            
            tags.forEach(tag => {
                const cleanTag = typeof tag === 'string' ? tag : String(tag)
                tagCounts[cleanTag] = (tagCounts[cleanTag] || 0) + 1
            })
        }
    })
    
    tagsContainer.empty()
    
    const existingTags = new Set()
    tagsContainer.querySelectorAll('.tag-manager-item').forEach(item => {
        existingTags.add(item.textContent)
    })
    
    // Display tags from settings with their counts
    this.plugin.settings.tags.forEach(tag => {
        // Skip if already exists
        if (existingTags.has(tag)) return
        
        const count = tagCounts[tag] || 0
        this.createTagItem(tag, count, tagsContainer as HTMLElement)
    })
}

    createTagItem(tag: string, tagCount: number, container: HTMLElement) {
        const tagItem = container.createDiv('tag-manager-item')
        const tagContent = tagItem.createDiv('tag-content')
        const btnContainer = tagItem.createDiv('btn-Container')
        
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const countBadge = tagContent.createEl('span', {  
            text: tagCount.toString(),
            cls: 'tag-count'
        })
        
         
        const tagName = tagContent.createEl('span', { 
            text: tag,
            cls: 'tag-name'
        })
        
        tagContent.addEventListener('click', () => {
            // Copy tag to clipboard for easy use
            navigator.clipboard.writeText(tag).catch(error => {
                console.error(error)
            })
            new Notice(`Copied: ${tag}`)
        })
        const editBtn = btnContainer.createEl('button', {
            text: '✎',
            cls: 'tag-edit-btn',
            title:"Edit tag"
        })
        // Delete button
        const deleteBtn = btnContainer.createEl('button', {
            text: '×',
            cls: 'tag-delete-btn',
            title: 'Delete tag'
        })

        editBtn.addEventListener('click',  (e) => {
            if (tagCount > 0) {
                const modal = new EditModal(
                    this.plugin.app,
                    tag,
                    tagCount,
                    (newName: string | null) => {
                        if (newName && newName !== tag) {
                            try {
                                void this.EditTag(tag, newName)
                                new Notice(`Successfully renamed tag from #${tag} to #${newName}`)
                                tagName.setText(newName)
                            } catch (error) {
                                console.error("Failed to edit tag:", error)
                                new Notice(`Failed to rename tag: ${String(error)}`)
                            }
                        }
                    }
                )
                modal.open()
            } else {
                tagName.setText('')
                tagName.removeClass('tag-input-mode')
                const input = tagName.createEl('input', {
                    type: 'text',
                    value: tag,
                    cls: 'tag-input',
                })

                input.removeAttribute('title')
                input.select()
                
                // Handle Enter to save
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        const newTag = input.value.trim()
                        if (newTag && newTag !== tag) {
                            this.plugin.addNewTag(newTag).catch(console.error)
                            this.plugin.removeTag(tag).catch(console.error)
                            tagName.setText(newTag)
                        } else {
                            tagName.setText(tag)
                        }
                    }
                    
                    if (e.key === 'Escape') {
                        tagName.setText(tag)
                    }
                })
                    
                input.addEventListener('blur', () => {
                    tagName.setText(tag)
                })
                
                tagName.removeClass('tag-input-mode')
            }
        })

        deleteBtn.addEventListener('click', (e) => {
            void (async () => {
                let confirmed = false
                if (tagCount > 0) {
                    // Show warning for tags that are in use
                    const title = 'Delete tag warning'
                    const warninfo ={
                        txt: `This tag is used in ${tagCount} file${tagCount> 1 ? 's' : ''}.`,
                        txt1: `Deleting "${tag}" will remove it from all files.`,
                        txt2: "This action cannot be undone."
                    } 
                    const confirmbtn = `Delete from ${tagCount} file${tagCount > 1 ? 's' : ''}`
                    
                    confirmed = await this.plugin.showCriticalWarning(title, warninfo, confirmbtn)
                } else {
                    const modal = new ConfirmationModal(this.plugin.app, `Delete tag "${tag}"?`, "Warning ")
                    modal.open()
                    confirmed = await modal.promise 
                }
                if (confirmed) {
                    await this.handleTagDeletion(tag)
                }
            })().catch(error => {
                console.error("Failed to delete tag", error)
                new Notice('Failed to delete tag')
            })
        })
        return tagItem
    }
   async EditTag(tag: string, edit: string) {
        const files = this.plugin.app.vault.getMarkdownFiles()
        for (const file of files) {
            try {
                const content = await this.plugin.app.vault.read(file)
                const tagRegex = new RegExp(`(#|\\-\\s)${tag}\\b`, 'g')
                if (tagRegex.test(content)) {
                    tagRegex.lastIndex = 0
                    const newContent = content.replace(tagRegex, `$1${edit}`)
                    await this.plugin.app.vault.modify(file, newContent)
                }
                await this.plugin.addNewTag(edit)
                await this.plugin.removeTag(tag)
            } catch (error) {
                console.error(`Error processing ${file.path}:`, error)
                new Notice(`Failed to edit tag in ${String(error)}`)
            }
        }
    }
   
    async DeleteTag(tag: string) {
        const tagsList = this.containerEl.querySelector('#tag-manager-list')
        if (!tagsList) return

        const tagItems = tagsList.querySelectorAll('.tag-manager-item')
        tagItems.forEach (item =>{
            const tagName = item.querySelector('.tag-name')?.textContent
            if (tagName === tag) {
                item.remove()
            }
        })

        this.updateStats()
    }

   filterTags(searchTerm: string) {
    const tagsList = this.containerEl.querySelector('#tag-manager-list')
    if (!tagsList) return
    
    const tagItems = tagsList.querySelectorAll('.tag-manager-item')
    const searchLower = searchTerm.toLowerCase()
    
    tagItems.forEach(item => {
        const tagName = item.querySelector('.tag-name')?.textContent?.toLowerCase() || ''
        const isVisible = tagName.includes(searchLower)
        
        if (isVisible) {
            item.classList.remove('tag-hidden')
        } else {
            item.classList.add('tag-hidden')
        }
    })
}

    updateStats() {
        const stats = this.containerEl.querySelector('.tag-manager-stats')
        if (stats) {
            stats.textContent = `${this.plugin.settings.tags.length} tags in your collection`
        }
    }

    sortTags(sortBy: 'name' | 'count' | 'relevance', searchTerm?: string) {
        const tagsList = this.containerEl.querySelector('#tag-manager-list')
        if (!tagsList) return
        
        const tagItems = Array.from(tagsList.querySelectorAll('.tag-manager-item'))
        
        switch (sortBy) {
            case 'name':
                this.sortByName(tagItems)
                break
            case 'count':
                this.sortByCount(tagItems)
                break
            case 'relevance':
                if (searchTerm) {
                    this.sortByRelevance(searchTerm, tagItems)
                } else {
                    this.sortByName(tagItems)
                }
                break
        }
        
        // Reattach in sorted order
        this.reorderTagItems(tagItems)
    }

    renderSearchAndSort() {
        const controlContainer = this.containerEl.createDiv('tag-search-sort-container')
        
        // Search input
        const searchInput = controlContainer.createEl('input', {
            type: 'text',
            placeholder: 'Search tags...',
            cls: 'tag-search-input'
        })
        
        // Sort button (triggers dropdown)
        const sortbtn = controlContainer.createEl('button', {
            text: 'Sort by count',
            cls: 'tag-btn'
        })
        
        // Floating dropdown overlay
        const dropdown = controlContainer.createDiv('tag-sort-dropdown')
        
        const sortOptions = [
            { id: 'count', text: 'Count', icon: '↓', label: 'Sort by Count' },
            { id: 'name', text: 'Name A-Z', icon: 'A-Z', label: 'Sort by Name A-Z' },
            { id: 'relevance', text: 'Relevance', icon: '★', label: 'Sort by Relevance' }
        ]
        
        sortOptions.forEach(option => {
            const item = dropdown.createDiv('tag-sort-item')
            item.setAttribute('data-sort', option.id)
            
            item.createEl('span', { 
                text: option.icon, 
                cls: 'sort-icon' 
            })
            item.createEl('span', { 
                text: option.text, 
                cls: 'sort-text' 
            })
            
            item.addEventListener('click', () => {
                const searchTerm = searchInput.value.trim()
                
                // Update button text
                sortbtn.textContent = option.label
                
                // Perform sort
                if (option.id === 'relevance' && !searchTerm) {
                    this.sortTags('count')
                    sortbtn.textContent = 'Sort by count'
                } else if (option.id === 'relevance') {
                    this.sortTags('relevance', searchTerm)
                } else {
                    this.sortTags(option.id as 'name' | 'count')
                }
                
                // Close dropdown
                dropdown.classList.remove('active')
            })
        })

        // Toggle dropdown
        sortbtn.addEventListener('click', (e) => {
            e.stopPropagation()
            dropdown.classList.toggle('active')
        })
        
        const addbtn = controlContainer.createEl('button', {
            text: '+',
            cls: 'tag-btn'
        })

        addbtn.addEventListener('click', (e) => {
            this.handle.open()
        })
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!controlContainer.contains(e.target as Node)) {
                dropdown.classList.remove('active')
            }
        })
        
        // Search functionality
        searchInput.addEventListener('input', () => {
            const searchTerm = searchInput.value.trim()
            this.filterTags(searchTerm)
            
            if (searchTerm) {
                this.sortTags('relevance', searchTerm)
                sortbtn.textContent = 'Sort by relevance'
            }
        })
    }


    private async handleTagDeletion(tag: string): Promise<void> {
        try {
            // Remove tag from plugin settings
            const removed = await this.plugin.removeTag(tag)
            
            if (removed) {
                // Remove tag from all markdown files
                await this.removeTagFromAllFiles(tag).catch(error => {
                    console.error("Tag Removal Error", error)
                })
                
               await this.DeleteTag(tag).catch(error => {
                    console.error("Tag Deletion Error:", error)
               })
                
                // Update stats
                this.updateStats()
                
                new Notice(`Deleted tag "${tag}" from all files`)
            }
        } catch (error) {
            console.error('Error deleting tag:', error)
            new Notice(`Failed to delete tag "${tag}"`)
        }
    }

    private async removeTagFromAllFiles(tag: string): Promise<void> {
        const files = this.plugin.app.vault.getMarkdownFiles()
        
        for (const file of files) {
            try {
                let content = await this.plugin.app.vault.read(file)
                let modified = false
                
                // Remove inline #tag references
                const regex = new RegExp(`(#|\\-\\s)${tag}\\b`, 'g')
                const newContent = content.replace(regex, '')
                if (newContent !== content) {
                    content = newContent
                    modified = true
                }
                
                // Remove from frontmatter tags array
                const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
                if (frontmatterMatch?.[1]) {
                    const frontmatter = frontmatterMatch[1]
                    const lines = frontmatter.split('\n')
                    const newLines = []
                    
                    for (const line of lines) {
                        if (line.startsWith('tags:')) {
                            // Parse tags array
                            const tagsMatch = line.match(/tags:\s*\[(.*)\]/)
                            if (tagsMatch) {
                                const tagsStr = tagsMatch[1]
                                if (!tagsStr) continue
                                const tagsArray = tagsStr.split(',')
                                    .map(t => t.trim().replace(/["']/g, ''))
                                    .filter(t => t !== tag)
                                
                                if (tagsArray.length > 0) {
                                    const newTags = tagsArray.map(t => `"${t}"`).join(', ')
                                    newLines.push(`tags: [${newTags}]`)
                                } else {
                                    newLines.push('tags: []')
                                }
                                modified = true
                            } else {
                                newLines.push(line)
                            }
                        } else {
                            newLines.push(line)
                        }
                    }
                    
                    if (modified) {
                        const newFrontmatter = newLines.join('\n')
                        content = content.replace(frontmatterMatch[0], `---\n${newFrontmatter}\n---`)
                    }
                }
                
                if (modified) {
                    await this.plugin.app.vault.modify(file, content)
                }
                
            } catch (error) {
                console.error(`Error updating file ${file.path}:`, error)
            }
        }
    }

    // Sort alphabetically (A-Z)
    private sortByName(tagItems: Element[]) {
        tagItems.sort((a, b) => {
            const aName = a.querySelector('.tag-name')?.textContent || ''
            const bName = b.querySelector('.tag-name')?.textContent || ''
            return aName.localeCompare(bName, undefined, { numeric: true })
        })
    }

    // Sort by count (descending), then alphabetically
    private sortByCount(tagItems: Element[]) {
        tagItems.sort((a, b) => {
            const aCountText = a.querySelector('.tag-count')?.textContent || '0'
            const bCountText = b.querySelector('.tag-count')?.textContent || '0'
            const aCount = parseInt(aCountText)
            const bCount = parseInt(bCountText)
            
            if (bCount !== aCount) return bCount - aCount
            
            const aName = a.querySelector('.tag-name')?.textContent || ''
            const bName = b.querySelector('.tag-name')?.textContent || ''
            return aName.localeCompare(bName)
        })
    }

    // Sort by relevance to search term
    private sortByRelevance(searchTerm: string, tagItems: Element[]) {
        const searchLower = searchTerm.toLowerCase()
        
        tagItems.sort((a, b) => {
            const aName = a.querySelector('.tag-name')?.textContent?.toLowerCase() || ''
            const bName = b.querySelector('.tag-name')?.textContent?.toLowerCase() || ''
            const aCountText = a.querySelector('.tag-count')?.textContent || '0'
            const bCountText = b.querySelector('.tag-count')?.textContent || '0'
            const aCount = parseInt(aCountText)
            const bCount = parseInt(bCountText)
            
            // Calculate relevance scores
            const aScore = this.calculateRelevanceScore(aName, searchLower, aCount)
            const bScore = this.calculateRelevanceScore(bName, searchLower, bCount)
            
            if (bScore !== aScore) return bScore - aScore
            if (bCount !== aCount) return bCount - aCount
            return aName.localeCompare(bName)
        })
    }

    // Calculate relevance score for a tag
    private calculateRelevanceScore(tagName: string, searchTerm: string, count: number): number {
        let score = 0
        
        // Exact match gets highest priority
        if (tagName === searchTerm) score += 1000
        
        // Starts with search term
        else if (tagName.startsWith(searchTerm)) score += 100
        
        // Contains search term anywhere
        else if (tagName.includes(searchTerm)) score += 10
        
        // Boost by usage count (but less than search relevance)
        score += Math.min(count, 5)
        
        return score
    }

    // Reorder items in the DOM
    private reorderTagItems(tagItems: Element[]) {
        const tagsList = this.containerEl.querySelector('#tag-manager-list')
        if (!tagsList) return
        
        // Clear and re-add in sorted order
        tagsList.innerHTML = ''
        tagItems.forEach(item => {
            if ((item as HTMLElement).style.display !== 'none') {
                tagsList.appendChild(item)
            }
        })
    }
}

//================MODAL ==================
class WelcomeModal extends Modal {
    plugin: ImageTagPlugin
    
    constructor(app: App, plugin: ImageTagPlugin) {
        super(app)
        this.plugin = plugin
    }

    onOpen() {
        this.containerEl.addClass('welcome-modal')
        this.titleEl.setText('Welcome to better image tag')

        // Main instruction container
        const instructionDiv = this.contentEl.createDiv('.instruction')
        instructionDiv.createEl('p', { text: 'Thank you for installing the better image tag! This plugin helps you organize and tag images in your vault.' })

        // How to use section
        this.contentEl.createEl('h2', { text: 'How to use' })
        
        this.contentEl.createEl('h3', { text: '1. Add desired tags in tag manager tab' })
        this.contentEl.createEl('p', { text: 'Go to the plugin settings and add custom tags that you want to use for your images.' })
        
        this.contentEl.createEl('h3', { text: '2. Right click any image in vault and select image tag to create note with tags' })
        this.contentEl.createEl('p', { text: 'In the file explorer, right-click on any image file and choose "add image tags" from the context menu.' })
        
        this.contentEl.createEl('h3', { text: '3. Manage your tagged images' })
        this.contentEl.createEl('p', { text: 'Use the tag manager to view all tagged images, search by tags, and manage your image collection.' })

        // Optional features section
        this.contentEl.createEl('h2', { text: 'Optional' })
        this.contentEl.createEl('p', { text: 'You can merge tags in your vault to plugin by checking scan tag in plugin settings' })
        this.contentEl.createEl('p', { text: 'This will scan your existing notes for tags and add them to your tag manager.' })

        // Quick tips section
        this.contentEl.createEl('h2', { text: 'Quick tips' })
        const tipsList = this.contentEl.createEl('ul')
        tipsList.createEl('li', { text: 'Use # in front of tags (e.g., #landscape, #portrait)' })
        tipsList.createEl('li', { text: 'You can add multiple tags to a single image' })
        tipsList.createEl('li', { text: 'Tags are stored in the image\'s frontmatter' })

        // Don't show again option
        const footer = this.contentEl.createDiv('modal-footer')
        const dontShowAgain = footer.createEl('label')
        const checkbox = dontShowAgain.createEl('input', { type: 'checkbox' })
        dontShowAgain.appendText(' Don\'t show this welcome message again')
        
        checkbox.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement
            this.plugin.settings.showWelcomeModal = !target.checked
            this.plugin.saveSettings().catch(console.error)
        })

        // Close button
        const closeButton = footer.createEl('button', { text: 'Get started' })
        closeButton.classList.add('mod-cta')
        closeButton.addEventListener('click', () => this.close())
    }

    onClose() {
        const { contentEl } = this
        contentEl.empty()
    }
}

class TagAddingModal extends Modal {
    plugin: ImageTagPlugin
    tab: TagManagerView
    tagName: string  = ''

    constructor(app: App){
        super(app)
    }

    onOpen() {
        this.titleEl.setText ('Add new tag')
        
        // Author input
        new PluginSettings(this.contentEl)
            .setName('Tag name')
            .addText(text => text
                .setPlaceholder('E.g. , landscape, character')
                .setValue(this.tagName)
                .onChange(value => this.tagName= value))
        // Action buttons
        const btnContainer = this.contentEl.createDiv('ImageTag-btn-container')
        
        new PluginSettings(btnContainer)
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => this.close()))
            .addButton(btn => btn
                .setButtonText('Add tag')
                .setCta()
                .onClick(()=>this.addTag()))

        this.scope.register([], 'Escape', (evt) => {
            evt.preventDefault()
            this.close()
        })

          this.scope.register([], 'Enter', async (evt) => {
            evt.preventDefault()
            await this.addTag()
        })
    }
            
    async addTag() {
        if (!this.tagName) {
            new Notice('Please enter a tag name')
            return
        }
        
        const success = await this.plugin.addNewTag(this.tagName)
        if (success) {
            this.tab.renderTagsList()
            this.tab.updateStats()
            new Notice(`Added tag: ${this.tagName}`)
        } else {
            new Notice('Tag already exists')
        }
        this.close()
    }
    

    onClose() {
        const {contentEl} = this
        contentEl.empty()
    }
}

class NoteAddingModal extends Modal {
    selectedTags: Set<string> = new Set()
    allTags: string[]
    imageName: string
    defaultFolder: string
    author: string = ''
    noteContent: string = ''

    constructor(app: App, imageName: string, allTags: string[], defaultFolder: string) {
        super(app)
        this.imageName = imageName
        this.allTags = allTags
        this.defaultFolder = defaultFolder
    }

    onOpen() {
        const fileName = this.imageName.split('/').pop() || this.imageName
        this.titleEl.setText(`Tag: ${fileName}`)
        
        // Tag selection area
        this.contentEl.createEl('p', { 
            text: 'Click tags to select (selected tags will be highlighted):',
            cls: 'tag-instruction'
        })
        
        const tagsContainer = this.contentEl.createDiv('ImageTag-tags-container')
        
        // Display all tags as clickable buttons
        this.allTags.forEach(tag => {
            const btn = tagsContainer.createEl('button', {
                text: tag,
                cls: 'ImageTag-tag-btn'
            })
            
            if (this.selectedTags.has(tag)) {
                btn.addClass('ImageTag-tag-selected')
            }
            
            btn.addEventListener('click', () => {
                if (this.selectedTags.has(tag)) {
                    this.selectedTags.delete(tag)
                    btn.removeClass('ImageTag-tag-selected')
                } else {
                    this.selectedTags.add(tag)
                    btn.addClass('ImageTag-tag-selected')
                }
            })
        })

        // Author input
        new PluginSettings(this.contentEl)
            .setName('Author (optional)')
            .setDesc('Who created this image?')
            .addText(text => text
                .setPlaceholder('E.g. ,author name, studio name')
                .setValue(this.author)
                .onChange(value => this.author = value))

        // Note content
        new PluginSettings(this.contentEl)
            .setName('Notes (optional)')
            .setDesc('Add any observations or thoughts')
            .addTextArea(text => text
                .setPlaceholder('What do you like about this image? How might you use it?')
                .setValue(this.noteContent)
                .onChange(val => this.noteContent = val))

        // Action btns
        const btnContainer = this.contentEl.createDiv('ImageTag-btn-container')
        
        new PluginSettings(btnContainer)
            .addButton(btn => btn
                .setButtonText('Create note')
                .setCta()
                .onClick(() => this.createNote()))
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => this.close()))
    }

    async createNote() {
        const tagsArray = Array.from(this.selectedTags)
        
        // Create frontmatter
        const frontmatter = `---
image: "${this.imageName}"
author: "${this.author}"
tags: [${tagsArray.map(t => `"${t}"`).join(', ')}]
created: "${new Date().toISOString().split('T')[0]}"
---`

        // Create note body
        const body = `![[${this.imageName}|600]]

${this.noteContent ? `## Notes\n\n${this.noteContent}` : ''}`

        const fullContent = `${frontmatter}\n\n${body}`

        // Determine folder path
        const folderPath = this.defaultFolder
        const safeImageName = this.imageName.replace(/[<>:"/\\|?*]/g, '_')
        const baseName = safeImageName.replace(/\.[^/.]+$/, '')
        const fileName = `${baseName}.md`
        const fullPath = folderPath ? `${folderPath}/${fileName}` : fileName

        try {
            // Ensure folder exists
            if (folderPath) {
                // @ts-ignore - internal API
                const folderExists = await this.app.vault.adapter.exists(folderPath)
                if (!folderExists) {
                    // @ts-ignore
                    await this.app.vault.adapter.mkdir(folderPath)
                }
            }

            // Create the note
            await this.app.vault.create(fullPath, fullContent)
            
            // Open the note if setting is enabled
            //@ts-ignore
             // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            if (this.app.plugins.plugins?.ImageTag?.settings?.autoOpenModal) {
                const leaf = this.app.workspace.getLeaf()
                const file = this.app.vault.getAbstractFileByPath(fullPath)
                if (file) {
                    // @ts-ignore
                    await leaf.openFile(file)
                }
            }
            
            new Notice(`Created: ${fileName}`)
        } catch (error) {
            console.error('Error creating note:', error)
            new Notice('Failed to create note')
        }

        this.close()
    }

    onClose() {
        const {contentEl} = this
        contentEl.empty()
    }
}

class EditModal extends Modal {
    public edit: string = ""
    private oldTagName: string
    private tagCount: number
    private onConfirm: (newName: string) => void
    private onCloseCallback?: () => void

    constructor(
        app: App, 
        oldTagName: string, 
        tagCount: number,
        onConfirm: (newName: string) => void,
        onCloseCallback?: () => void
    ) {
        super(app)
        
        this.oldTagName = oldTagName
        this.tagCount = tagCount
        this.onConfirm = onConfirm
        this.onCloseCallback = onCloseCallback
        this.edit = oldTagName

        this.titleEl.setText('Editing tag name')
        
        new PluginSettings(this.contentEl)
            .setName("New tag name")
            .setDesc(`This edit would apply to ${tagCount} entit${tagCount > 1 ? 'ies' : 'y'} in all files.`)
            .addText(text => text
                .setValue(oldTagName)
                .onChange(val => {
                    this.edit = val
                })
            )
        
        const btnContainer = this.contentEl.createDiv({ cls: 'modal-button-container' })

        const cancelBtn = btnContainer.createEl('button', { text: 'Cancel' })
        cancelBtn.addEventListener('click', () => {
            if (this.onCloseCallback) this.onCloseCallback()
            this.close()
        })

        const confirmBtn = btnContainer.createEl('button', { 
            text: 'Confirm',
            cls: 'mod-cta'
        })
        confirmBtn.addEventListener('click', () => {
            if (this.edit.trim() && this.edit !== this.oldTagName) {
                this.onConfirm(this.edit)
            }
            if (this.onCloseCallback) this.onCloseCallback()
            this.close()
        })

        this.scope.register([], 'Enter', (evt) => {
            evt.preventDefault()
            if (this.edit.trim() && this.edit !== this.oldTagName) {
                this.onConfirm(this.edit)
            }
            if (this.onCloseCallback) this.onCloseCallback()
            this.close()
        })

        this.scope.register([], 'Escape', (evt) => {
            evt.preventDefault()
            if (this.onCloseCallback) this.onCloseCallback()
            this.close()
        })
    }

    onOpen(): void {
        void super.onOpen()
        const input = this.contentEl.querySelector('input')
        if (input) {
            input.focus()
            input.select()
        }
    }
}

class ConfirmationModal extends Modal {
    private resolvePromise: (value: boolean) => void
    public promise: Promise<boolean>

    constructor(app: App, message: string, title: string ) {
        super(app)

        this.promise = new Promise((resolve) => {
            this.resolvePromise = resolve
        })

        this.titleEl.setText(title)
        this.contentEl.createEl('p', { text: message })

        const btnContainer = this.contentEl.createDiv({ cls: 'modal-button-container' })

        btnContainer.createEl('button', { text: 'Cancel' })
            .addEventListener('click', () => {
                this.resolvePromise(false)
                this.close()
            })

        const confirmBtn = btnContainer.createEl('button', { 
            text: 'Confirm',
            cls: 'mod-cta' 
        })
        confirmBtn.addEventListener('click', () => {
            this.resolvePromise(true)
            this.close()
        })
        this.scope.register([], 'Enter', (evt) => {
            evt.preventDefault()
            // Trigger confirm action
            this.close()
        })

        // Optional: Close on Escape key
        this.scope.register([], 'Escape', () => {
            this.resolvePromise(false)
            this.close()
            return false
        })
    }

    onOpen() {
        void super.onOpen()
    }
}

// ==================== SETTINGS TAB ====================
class ImageTagSettingTab extends PluginSettingTab {
    plugin: ImageTagPlugin

    constructor(app: App, plugin: ImageTagPlugin) {
        super(app, plugin)
        this.plugin = plugin
    }

    display(): void {
        const {containerEl} = this
        containerEl.empty()

        new PluginSettings(containerEl).setName("Image tag settings").setHeading()

        // Default folder setting
        new PluginSettings(containerEl)
            .setName('Default folder')
            .setDesc('Where to save image reference notes')
            .addText(text => text
                .setPlaceholder('Image library')
                .setValue(this.plugin.settings.defaultFolder)
                .onChange(async (value) => {
                    this.plugin.settings.defaultFolder = value
                    await this.plugin.saveSettings()
                })
            )

        // Auto-open modal setting
        new PluginSettings(containerEl)
            .setName('Auto-open notes')
            .setDesc('Automatically open newly created notes')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoOpenModal)
                .onChange(async (value) => {
                    this.plugin.settings.autoOpenModal = value
                    await this.plugin.saveSettings()
                })
            )

        // Tag manager section
        new PluginSettings(containerEl).setName("Tag management").setHeading()

        // Open sidebar button
        new PluginSettings(containerEl)
            .setName('Tag manager sidebar')
            .setDesc('Open the tag manager in the sidebar')
            .addButton(btn => btn
                .setButtonText('Open sidebar')
                .setCta()
                .onClick(() => {
                    this.plugin.activateTagManagerView().catch(error => {
                            console.error('Failed to open tag manager:', error)
                            // Show notice to user
                            new Notice('Failed to open tag manager')
                        })
                }))
		// Tag scanning section
		new PluginSettings(containerEl)
			.setName('Scan vault for tags')
			.setDesc('Find all existing #tags in your vault and add them to the tag manager')
			.addButton(btn => btn
				.setButtonText('Scan now')
				.onClick(async () => {
                    const modal = new ConfirmationModal(this.app, 'This may take a few moments.', 'Scan your entire vault for existing tags? ')
                    modal.open()
					let confirmed =  false
                    confirmed = await modal.promise
					if (confirmed) {
						await this.plugin.scanForExistingTags()
					}
        }))
        // Reset to defaults
        new PluginSettings(containerEl)
            .setName('Reset to defaults')
            .setDesc('Reset all settings and tags to default values')
            .addButton(btn => btn
                .setButtonText('Reset')
                .setWarning()
                .onClick(async () => {
                    const title = "Reset everything to default"
                    const warninfo = {
                        txt: 'Are you sure to reset everything?',
                        txt1: 'This Action will also remove all your saved tag.',
                        txt2:'Think twice before action!!!'
                    }
                    const confirm =  await this.plugin.showCriticalWarning(title, warninfo, " I'm sure about what am I doing")
                    if (confirm) {
                        this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS)
                        await this.plugin.saveSettings()
                        this.display() // Refresh
                        new Notice('Settings reset to defaults')
                    }
                }))
    }
}