'use strict';

import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import { MobDebugSession } from './mobDebug';

export function activateMobDebug(context: vscode.ExtensionContext, factory?: vscode.DebugAdapterDescriptorFactory) {


	// register a configuration provider for 'mock' debug type
	const provider = new MobConfigurationProvider();
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('mobdebug', provider));

	if (!factory) {
		factory = new InlineDebugAdapterFactory();
	}
	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('mock', factory));

	if ('dispose' in factory) {
		context.subscriptions.push(<any>factory);
	}
}

class MobConfigurationProvider implements vscode.DebugConfigurationProvider {

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {

		// if launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'markdown') {
				config.type = 'mock';
				config.name = 'Launch';
				config.request = 'launch';
				config.program = '${file}';
				config.stopOnEntry = true;
			}
		}

		if (!config.program) {
			return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
				return undefined;	// abort launch
			});
		}

		return config;
	}
}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {

	createDebugAdapterDescriptor(session: vscode.DebugSession): ProviderResult<vscode.DebugAdapterDescriptor> {
		
		return new vscode.DebugAdapterInlineImplementation(new MobDebugSession(workspaceFileAccessor));
	}
}
