/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWebviewService } from '../../../contrib/webview/browser/webview.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { URI } from '../../../../base/common/uri.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';

export interface IBrowserPreviewService {
	readonly _serviceBrand: undefined;
	openBrowser(url: string): Promise<void>;
	getLastSelectedDOM(): string | null;
}

export const IBrowserPreviewService = createDecorator<IBrowserPreviewService>('browserPreviewService');

class BrowserPreviewService extends Disposable implements IBrowserPreviewService {
	readonly _serviceBrand: undefined;

	private _lastSelectedDOM: string | null = null;

	constructor(
		@IWebviewService private readonly _webviewService: IWebviewService,
		@IEditorService private readonly _editorService: IEditorService
	) {
		super();
	}

	public getLastSelectedDOM(): string | null {
		return this._lastSelectedDOM;
	}

	public async openBrowser(url: string): Promise<void> {
		const webview = this._webviewService.createWebviewOverlay({
			title: 'Browser Preview',
			options: {
				enableScripts: true,
				localResourceRoots: []
			},
			contentOptions: {
				allowScripts: true,
			},
			extension: undefined
		});

		// Fetch content via a proxy (simulated here for simplicity by fetching directly if CORS allows, otherwise warning)
		// In a real implementation, we would use a main process channel to fetch(url).
		try {
			const response = await fetch(url);
			let html = await response.text();

			// Inject our selection script directly into the HTML body
			const script = `
				<script>
					const vscode = acquireVsCodeApi();
					document.body.addEventListener('click', (e) => {
						e.preventDefault();
						e.stopPropagation();
						const element = e.target;
						vscode.postMessage({
							type: 'dom-selected',
							html: element.outerHTML
						});
						element.style.outline = '2px solid red'; // Visual feedback
					}, true);
				</script>
			`;

			// Insert before </body>
			html = html.replace('</body>', script + '</body>');

			// Handle base tag for relative links
			if (!html.includes('<base')) {
				html = html.replace('<head>', `<head><base href="${url}">`);
			}

			webview.html = html;
		} catch (e) {
			webview.html = `<h3>Error loading ${url}</h3><p>${e}</p><p>Note: Cross-Origin restrictions prevent loading some external sites directly. Localhost usually works.</p>`;
		}

		webview.onMessage(e => {
			if (e.type === 'dom-selected') {
				this._lastSelectedDOM = e.html;
				console.log('Void Browser: DOM Element Selected', this._lastSelectedDOM);
			}
		});
	}
}

registerSingleton(IBrowserPreviewService, BrowserPreviewService, InstantiationType.Delayed);

export const VOID_OPEN_BROWSER_ACTION_ID = 'void.openBrowser';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VOID_OPEN_BROWSER_ACTION_ID,
			title: 'Void: Open Browser Preview',
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const service = accessor.get(IBrowserPreviewService);
		const quickInputService = accessor.get('IQuickInputService') as any; // Using simplified access

		const url = await quickInputService.input({
			prompt: 'Enter URL for Browser Preview',
			value: 'http://localhost:3000',
			placeHolder: 'http://localhost:3000'
		});

		if (url) {
			await service.openBrowser(url);
		}
	}
});
