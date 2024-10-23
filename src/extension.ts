'use strict';

import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import { MobDebugSession, IMobArguments } from './mobDebugAdapter';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('mobdebug', {
		resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {
			if (!config.type && !config.request && !config.name) {
				const editor = vscode.window.activeTextEditor;
				if (editor && editor.document.languageId === 'lua') {
					config.type = 'mobdebug';
					config.name = 'Mobdebug: Attach';
					config.request = 'attach';
				}
			}
			return config;
		}
	}));
	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('mobdebug', {
		createDebugAdapterDescriptor(session: vscode.DebugSession): ProviderResult<vscode.DebugAdapterDescriptor> {
			return new vscode.DebugAdapterInlineImplementation(new MobDebugSession(<IMobArguments>session.configuration));
		}
	}));
}

export function deactivate() {
	// nothing to do
}