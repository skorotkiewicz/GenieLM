import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export const provider = createOpenAICompatible({
	name: 'local',
	baseURL: 'http://192.168.0.124:8888/v1'
});
