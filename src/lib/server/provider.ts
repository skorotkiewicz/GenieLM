import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenAIOAuth } from '@openai-oauth/ai-sdk';
import { openaiCredentials } from '@openai-oauth/web/server';

export type ProviderConfig =
	| { type: 'compatible'; baseURL: string; model: string; apiKey?: string }
	| { type: 'oauth'; model: string };

export function parseProviderConfig(value: unknown): ProviderConfig {
	if (!value || typeof value !== 'object') throw new Error('Provider configuration is required.');
	const config = value as Record<string, unknown>;
	if (typeof config.model !== 'string' || !config.model.trim() || config.model.length > 200) {
		throw new Error('A valid model is required.');
	}

	if (config.type === 'oauth') return { type: 'oauth', model: config.model.trim() };
	if (config.type !== 'compatible' || typeof config.baseURL !== 'string') {
		throw new Error('A valid provider type is required.');
	}
	if (
		config.baseURL.length > 2_048 ||
		(config.apiKey != null && (typeof config.apiKey !== 'string' || config.apiKey.length > 10_000))
	) {
		throw new Error('Invalid OpenAI-compatible settings.');
	}

	const url = new URL(config.baseURL);
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
		throw new Error('The API URL must use HTTP or HTTPS and must not contain credentials.');
	}

	return {
		type: 'compatible',
		baseURL: url.toString().replace(/\/$/, ''),
		model: config.model.trim(),
		apiKey: config.apiKey || undefined
	};
}

export function modelForRequest(request: Request, value: unknown) {
	const config = parseProviderConfig(value);
	if (config.type === 'oauth') {
		return createOpenAIOAuth(openaiCredentials(request))(config.model);
	}

	return createOpenAICompatible({
		name: 'custom',
		baseURL: config.baseURL,
		apiKey: config.apiKey
	})(config.model);
}
