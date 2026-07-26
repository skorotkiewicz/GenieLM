import { describe, expect, test } from 'bun:test';
import { parseProviderConfig } from './provider';

describe('provider configuration', () => {
	test('accepts supported providers and rejects unsafe URLs', () => {
		expect(parseProviderConfig({ type: 'oauth', model: 'gpt-5.4-mini' })).toEqual({
			type: 'oauth',
			model: 'gpt-5.4-mini'
		});
		expect(
			parseProviderConfig({
				type: 'compatible',
				baseURL: 'http://localhost:8888/v1/',
				model: 'local-model',
				apiKey: ''
			})
		).toEqual({
			type: 'compatible',
			baseURL: 'http://localhost:8888/v1',
			model: 'local-model',
			apiKey: undefined
		});
		expect(() =>
			parseProviderConfig({
				type: 'compatible',
				baseURL: 'file:///etc/passwd',
				model: 'bad'
			})
		).toThrow();
	});
});
