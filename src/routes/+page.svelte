<script lang="ts">
	import BotIcon from '$lib/BotIcon.svelte';
	import { readChatStream } from '$lib/chat-stream';
	import { renderMarkdown } from '$lib/markdown';
	import {
		completeLogin,
		getSession,
		logout as logoutOpenAI,
		openaiAuthHeaders,
		startLogin
	} from '@openai-oauth/web';
	import { onMount, tick } from 'svelte';

	type Message = { role: 'user' | 'assistant'; content: string; reasoning?: string };
	type Chat = { id: string; title: string; createdAt: number; messages: Message[] };
	type HistoryGroup = { label: string; chats: Chat[] };
	type KnowledgeDocument = { id: number; name: string; createdAt: number; chunks: number };
	type ProviderSettings = {
		type: 'compatible' | 'oauth';
		baseURL: string;
		compatibleModel: string;
		oauthModel: string;
		apiKey: string;
	};

	let chats = $state<Chat[]>([]);
	let activeId = $state<string | null>(null);
	let draft = $state('');
	let loading = $state(false);
	let loaded = $state(false);
	let sidebarOpen = $state(true);
	let providerOpen = $state(false);
	let accountOpen = $state(false);
	let knowledgeOpen = $state(false);
	let knowledgeBusy = $state(false);
	let knowledgeDocuments = $state<KnowledgeDocument[]>([]);
	let knowledgeMessage = $state('');
	let shareLabel = $state('Share');
	let copiedMessage = $state<string | null>(null);
	let speakingMessage = $state<string | null>(null);
	let speechSupported = $state(false);
	let oauthSignedIn = $state(false);
	let authMessage = $state('');
	let provider = $state<ProviderSettings>({
		type: 'compatible',
		baseURL: '',
		compatibleModel: '',
		oauthModel: 'gpt-5.4-mini',
		apiKey: ''
	});
	let abortController: AbortController | null = null;

	const activeChat = $derived(chats.find((chat) => chat.id === activeId));
	const providerReady = $derived(
		provider.type === 'oauth'
			? oauthSignedIn && !!provider.oauthModel.trim()
			: !!provider.baseURL.trim() && !!provider.compatibleModel.trim()
	);
	const historyGroups = $derived.by(() => {
		const groups: HistoryGroup[] = [];
		for (const chat of chats) {
			const label = historyLabel(chat.createdAt);
			const group = groups.find((item) => item.label === label);
			if (group) group.chats.push(chat);
			else groups.push({ label, chats: [chat] });
		}
		return groups;
	});

	onMount(() => {
		let mounted = true;
		sidebarOpen = !window.matchMedia('(max-width: 760px)').matches;
		speechSupported = 'speechSynthesis' in window;

		const restoreFromUrl = () => {
			const id = conversationIdFromUrl();
			activeId = chats.some((chat) => chat.id === id) ? id : null;
		};

		async function initialize() {
			try {
				const saved = JSON.parse(localStorage.getItem('genielm-provider') ?? '{}');
				if (saved.type === 'compatible' || saved.type === 'oauth') provider.type = saved.type;
				if (typeof saved.baseURL === 'string') provider.baseURL = saved.baseURL;
				if (typeof saved.compatibleModel === 'string')
					provider.compatibleModel = saved.compatibleModel;
				if (typeof saved.oauthModel === 'string') provider.oauthModel = saved.oauthModel;
				provider.apiKey = sessionStorage.getItem('genielm-api-key') ?? '';
			} catch {
				localStorage.removeItem('genielm-provider');
			}

			try {
				const session = (await completeLogin()) ?? (await getSession());
				oauthSignedIn = !!session;
			} catch (error) {
				authMessage = error instanceof Error ? error.message : 'ChatGPT sign-in failed.';
			}

			if (!mounted) return;
			try {
				chats = JSON.parse(localStorage.getItem('genielm-chats') ?? '[]');
				const requestedId = conversationIdFromUrl();
				const savedId = localStorage.getItem('genielm-active-chat');
				activeId = chats.some((chat) => chat.id === requestedId)
					? requestedId
					: requestedId
						? null
						: chats.some((chat) => chat.id === savedId)
							? savedId
							: null;
				if (activeId && !requestedId) setConversationUrl(activeId, true);
			} catch {
				chats = [];
				activeId = null;
			}

			window.addEventListener('popstate', restoreFromUrl);
			loaded = true;
		}

		void initialize();
		return () => {
			mounted = false;
			window.speechSynthesis?.cancel();
			window.removeEventListener('popstate', restoreFromUrl);
		};
	});

	$effect(() => {
		if (!loaded) return;
		localStorage.setItem('genielm-chats', JSON.stringify(chats));
		localStorage.setItem(
			'genielm-provider',
			JSON.stringify({
				type: provider.type,
				baseURL: provider.baseURL,
				compatibleModel: provider.compatibleModel,
				oauthModel: provider.oauthModel
			})
		);
		if (provider.apiKey) sessionStorage.setItem('genielm-api-key', provider.apiKey);
		else sessionStorage.removeItem('genielm-api-key');
		if (activeId) localStorage.setItem('genielm-active-chat', activeId);
		else localStorage.removeItem('genielm-active-chat');
	});

	function historyLabel(timestamp: number) {
		const date = new Date(timestamp);
		const today = new Date();
		const day = 86_400_000;
		const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
		const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
		const age = Math.round((startOfToday - startOfDate) / day);

		if (age === 0) return 'Today';
		if (age === 1) return 'Yesterday';
		if (age < 7) return 'Last 7 Days';
		return date.toLocaleString(undefined, { month: 'long' });
	}

	function conversationIdFromUrl() {
		return new URLSearchParams(location.search).get('chat');
	}

	function setConversationUrl(id: string | null, replace = false) {
		const url = id ? `/?chat=${encodeURIComponent(id)}` : '/';
		if (replace) history.replaceState({}, '', url);
		else history.pushState({}, '', url);
	}

	function closeSidebarOnMobile() {
		if (window.matchMedia('(max-width: 760px)').matches) sidebarOpen = false;
	}

	function newChat() {
		stopSpeaking();
		activeId = null;
		draft = '';
		setConversationUrl(null);
		closeSidebarOnMobile();
	}

	function selectChat(id: string) {
		stopSpeaking();
		activeId = id;
		setConversationUrl(id);
		closeSidebarOnMobile();
	}

	function removeChat(chat: Chat) {
		if (!confirm(`Delete "${chat.title}"?`)) return;
		chats = chats.filter((item) => item.id !== chat.id);
		if (activeId === chat.id) {
			stopSpeaking();
			abortController?.abort();
			activeId = null;
			draft = '';
			setConversationUrl(null, true);
		}
	}

	async function scrollToBottom() {
		await tick();
		window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
	}

	async function shareChat() {
		if (!activeChat) return;
		const text = `# ${activeChat.title}\n\n${activeChat.messages
			.map((message) => `## ${message.role === 'user' ? 'You' : 'GenieLM'}\n\n${message.content}`)
			.join('\n\n')}`;

		try {
			if (navigator.share) {
				await navigator.share({ title: activeChat.title, text });
				shareLabel = 'Shared';
			} else {
				await navigator.clipboard.writeText(text);
				shareLabel = 'Copied';
			}
			setTimeout(() => (shareLabel = 'Share'), 1500);
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'AbortError')) {
				shareLabel = 'Failed';
				setTimeout(() => (shareLabel = 'Share'), 1500);
			}
		}
	}

	async function copyText(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			const textarea = document.createElement('textarea');
			textarea.value = text;
			textarea.style.position = 'fixed';
			textarea.style.opacity = '0';
			document.body.append(textarea);
			textarea.select();
			const copied = document.execCommand('copy');
			textarea.remove();
			return copied;
		}
	}

	async function copyMessage(content: string, id: string) {
		if (!(await copyText(content))) return;
		copiedMessage = id;
		setTimeout(() => {
			if (copiedMessage === id) copiedMessage = null;
		}, 1500);
	}

	function removeMessage(index: number) {
		if (!activeChat || loading || !confirm('Delete this message?')) return;
		stopSpeaking();
		copiedMessage = null;
		activeChat.messages.splice(index, 1);
	}

	function stopSpeaking() {
		if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
		speakingMessage = null;
	}

	function speakMessage(content: string, id: string) {
		if (!speechSupported) return;
		if (speakingMessage === id) {
			stopSpeaking();
			return;
		}

		stopSpeaking();
		const document = new DOMParser().parseFromString(renderMarkdown(content), 'text/html');
		document.querySelectorAll('.copy-code').forEach((button) => button.remove());
		const utterance = new SpeechSynthesisUtterance(document.body.textContent?.trim() || content);
		utterance.onend = utterance.onerror = () => {
			if (speakingMessage === id) speakingMessage = null;
		};
		speakingMessage = id;
		window.speechSynthesis.speak(utterance);
	}

	function codeCopy(node: HTMLElement) {
		async function handleClick(event: MouseEvent) {
			if (!(event.target instanceof Element)) return;
			const button = event.target.closest<HTMLButtonElement>('.copy-code');
			const code = button?.closest('pre')?.querySelector('code')?.textContent;
			if (!button || code == null || !(await copyText(code))) return;

			button.textContent = 'Copied';
			setTimeout(() => {
				if (button.isConnected) button.textContent = 'Copy';
			}, 1500);
		}

		node.addEventListener('click', handleClick);
		return { destroy: () => node.removeEventListener('click', handleClick) };
	}

	function currentProvider() {
		return provider.type === 'oauth'
			? { type: 'oauth' as const, model: provider.oauthModel.trim() }
			: {
					type: 'compatible' as const,
					baseURL: provider.baseURL.trim(),
					model: provider.compatibleModel.trim(),
					apiKey: provider.apiKey
				};
	}

	async function requestHeaders() {
		const headers = { 'content-type': 'application/json' };
		return provider.type === 'oauth' ? openaiAuthHeaders({ headers }) : headers;
	}

	async function signInWithChatGPT() {
		authMessage = '';
		try {
			const result = await startLogin();
			if (result.status === 'needs-extension') {
				const installWindow = window.open(result.installUrl, '_blank', 'noopener,noreferrer');
				if (!installWindow) authMessage = 'Allow popups to open the extension store.';
			}
		} catch (error) {
			authMessage = error instanceof Error ? error.message : 'ChatGPT sign-in failed.';
		}
	}

	async function signOutOfChatGPT() {
		await logoutOpenAI();
		oauthSignedIn = false;
		authMessage = '';
	}

	async function loadKnowledge() {
		try {
			const response = await fetch('/api/knowledge');
			const data = await response.json();
			if (!response.ok || !Array.isArray(data.documents)) throw new Error();
			knowledgeDocuments = data.documents;
			knowledgeMessage = '';
		} catch {
			knowledgeMessage = 'Could not load the local knowledge store.';
		}
	}

	function openKnowledge() {
		accountOpen = false;
		knowledgeOpen = true;
		void loadKnowledge();
	}

	async function uploadKnowledge(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		knowledgeBusy = true;
		knowledgeMessage = `Indexing ${file.name}…`;
		try {
			const body = new FormData();
			body.set('file', file);
			const response = await fetch('/api/knowledge', { method: 'POST', body });
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Could not index the document.');
			await loadKnowledge();
		} catch (error) {
			knowledgeMessage = error instanceof Error ? error.message : 'Could not index the document.';
		} finally {
			knowledgeBusy = false;
			input.value = '';
		}
	}

	async function removeKnowledge(document: KnowledgeDocument) {
		if (!confirm(`Delete "${document.name}" from local knowledge?`)) return;
		knowledgeBusy = true;
		try {
			const response = await fetch(`/api/knowledge?id=${document.id}`, { method: 'DELETE' });
			if (!response.ok) throw new Error();
			knowledgeDocuments = knowledgeDocuments.filter((item) => item.id !== document.id);
			knowledgeMessage = '';
		} catch {
			knowledgeMessage = 'Could not delete the document.';
		} finally {
			knowledgeBusy = false;
		}
	}

	async function summarizeTitle(
		chat: Chat,
		prompt: string,
		selectedProvider: ReturnType<typeof currentProvider>,
		headers: Record<string, string>
	) {
		try {
			const response = await fetch('/api/title', {
				method: 'POST',
				headers,
				body: JSON.stringify({ prompt, provider: selectedProvider })
			});
			if (!response.ok) return;
			const { title } = await response.json();
			if (typeof title === 'string' && title) chat.title = title;
		} catch {
			return;
		}
	}

	function stopResponse() {
		abortController?.abort();
	}

	async function sendMessage(event: SubmitEvent) {
		event.preventDefault();
		const content = draft.trim();
		if (!content || loading) return;
		if (!providerReady) {
			providerOpen = true;
			return;
		}

		let headers: Record<string, string>;
		try {
			headers = await requestHeaders();
		} catch (error) {
			authMessage = error instanceof Error ? error.message : 'Provider authentication failed.';
			providerOpen = true;
			return;
		}
		const selectedProvider = currentProvider();

		let chat = activeChat;
		if (!chat) {
			const id = crypto.randomUUID();
			chats = [{ id, title: content.slice(0, 48), createdAt: Date.now(), messages: [] }, ...chats];
			activeId = id;
			setConversationUrl(id, true);
			chat = chats[0];
			void summarizeTitle(chat, content, selectedProvider, headers);
		}

		const requestMessages = [...chat.messages, { role: 'user', content } satisfies Message];
		chat.messages.push(
			{ role: 'user', content },
			{ role: 'assistant', content: '', reasoning: '' }
		);
		const answerIndex = chat.messages.length - 1;
		draft = '';
		loading = true;
		const controller = new AbortController();
		abortController = controller;
		await scrollToBottom();

		try {
			const response = await fetch('/api/chat', {
				method: 'POST',
				signal: controller.signal,
				headers,
				body: JSON.stringify({
					provider: selectedProvider,
					messages: requestMessages.map((message, index) => ({
						id: `${chat.id}-${index}`,
						role: message.role,
						parts: [{ type: 'text', text: message.content }]
					}))
				})
			});
			if (!response.ok || !response.body) throw new Error('Request failed');

			await readChatStream(response.body, async (event) => {
				const message = chat.messages[answerIndex];
				if (event.type === 'reasoning-delta') {
					message.reasoning = (message.reasoning ?? '') + event.text;
				} else message.content += event.text;
				await scrollToBottom();
			});
			if (!chat.messages[answerIndex].content) throw new Error('Empty response');
		} catch {
			if (controller.signal.aborted) {
				if (!chat.messages[answerIndex].content) {
					chat.messages[answerIndex].content = 'Response stopped.';
				}
			} else {
				chat.messages[answerIndex].content =
					'Sorry, I could not reach the selected model. Please check your provider settings.';
			}
		} finally {
			if (abortController === controller) abortController = null;
			loading = false;
			await scrollToBottom();
		}
	}
</script>

<svelte:head>
	<title>GenieLM</title>
	<meta name="description" content="Chat with GenieLM" />
</svelte:head>

{#snippet messageActions(message: Message, index: number)}
	{@const id = `${activeId}-${index}`}
	<div class="message-actions">
		<button
			aria-label={copiedMessage === id ? 'Message copied' : 'Copy message'}
			title={copiedMessage === id ? 'Copied' : 'Copy message'}
			onclick={() => copyMessage(message.content, id)}
		>
			{#if copiedMessage === id}
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
			{:else}
				<svg viewBox="0 0 24 24" aria-hidden="true"
					><rect x="8" y="8" width="12" height="12" rx="2" /><path
						d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"
					/></svg
				>
			{/if}
		</button>
		<button
			aria-label={speakingMessage === id ? 'Stop speaking' : 'Speak message'}
			aria-pressed={speakingMessage === id}
			title={speechSupported ? 'Use system voice' : 'Speech is not supported by this browser'}
			disabled={!speechSupported}
			onclick={() => speakMessage(message.content, id)}
		>
			{#if speakingMessage === id}
				<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" /></svg
				>
			{:else}
				<svg viewBox="0 0 24 24" aria-hidden="true"
					><path d="M11 5 6 9H3v6h3l5 4Z" /><path
						d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"
					/></svg
				>
			{/if}
		</button>
		<button
			aria-label="Delete message"
			title={loading ? 'Wait for response to finish' : 'Delete message'}
			disabled={loading}
			onclick={() => removeMessage(index)}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true"
				><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg
			>
		</button>
	</div>
{/snippet}

<div class:sidebar-collapsed={!sidebarOpen} class="app-shell">
	<aside class="sidebar">
		<div class="sidebar-actions">
			<button
				class="icon-button back-button"
				aria-label="Collapse sidebar"
				onclick={() => (sidebarOpen = false)}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
			</button>
			<button class="icon-button" aria-label="New chat" onclick={newChat}>
				<svg viewBox="0 0 24 24" aria-hidden="true"
					><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" /><path
						d="m15 5 3 3"
					/></svg
				>
			</button>
		</div>

		<nav aria-label="Chat history">
			{#each historyGroups as group (group.label)}
				<section class="history-group">
					<h2>{group.label}</h2>
					{#each group.chats as chat (chat.id)}
						<div class="chat-item">
							<button
								class:active={chat.id === activeId}
								class="chat-link"
								onclick={() => selectChat(chat.id)}>{chat.title}</button
							>
							<button
								class="remove-chat"
								aria-label={`Delete ${chat.title}`}
								title="Delete conversation"
								onclick={() => removeChat(chat)}
							>
								<svg viewBox="0 0 24 24" aria-hidden="true"
									><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg
								>
							</button>
						</div>
					{/each}
				</section>
			{/each}
		</nav>
	</aside>
	{#if sidebarOpen}
		<button
			class="sidebar-backdrop"
			aria-label="Close sidebar"
			onclick={() => (sidebarOpen = false)}
		></button>
	{/if}

	<main>
		<header>
			<div class="header-start">
				{#if !sidebarOpen}<button
						class="open-sidebar"
						aria-label="Open sidebar"
						onclick={() => (sidebarOpen = true)}>☰</button
					>{/if}
				<div class="provider-control">
					{#if providerOpen}
						<button
							class="provider-backdrop"
							aria-label="Close provider settings"
							onclick={() => (providerOpen = false)}
						></button>
					{/if}
					<button
						class="brand"
						aria-expanded={providerOpen}
						aria-haspopup="dialog"
						onclick={() => {
							providerOpen = !providerOpen;
							accountOpen = false;
						}}
					>
						<span>GenieLM</span>
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
					</button>
					{#if providerOpen}
						<div class="provider-menu" role="dialog" aria-label="Model provider settings">
							<div class="provider-tabs" role="tablist" aria-label="Provider">
								<button
									class:active={provider.type === 'compatible'}
									role="tab"
									aria-selected={provider.type === 'compatible'}
									onclick={() => (provider.type = 'compatible')}>Compatible API</button
								>
								<button
									class:active={provider.type === 'oauth'}
									role="tab"
									aria-selected={provider.type === 'oauth'}
									onclick={() => (provider.type = 'oauth')}>ChatGPT</button
								>
							</div>

							{#if provider.type === 'compatible'}
								<label>
									<span>Base URL</span>
									<input
										type="url"
										bind:value={provider.baseURL}
										placeholder="http://localhost:8888/v1"
									/>
								</label>
								<label>
									<span>Model</span>
									<input bind:value={provider.compatibleModel} placeholder="Model name" />
								</label>
								<label>
									<span>API key <small>(optional)</small></span>
									<input
										type="password"
										bind:value={provider.apiKey}
										placeholder="Stored for this tab only"
										autocomplete="off"
									/>
								</label>
								<button
									class="provider-primary"
									disabled={!providerReady}
									onclick={() => (providerOpen = false)}>Use this API</button
								>
							{:else}
								<div class:signed-in={oauthSignedIn} class="oauth-status">
									<span></span>{oauthSignedIn ? 'Connected to ChatGPT' : 'Not connected'}
								</div>
								<label>
									<span>Model</span>
									<input bind:value={provider.oauthModel} placeholder="gpt-5.4-mini" />
								</label>
								{#if oauthSignedIn}
									<button class="provider-primary" onclick={() => (providerOpen = false)}
										>Use ChatGPT</button
									>
									<button class="provider-secondary" onclick={signOutOfChatGPT}>Sign out</button>
								{:else}
									<button class="provider-primary" onclick={signInWithChatGPT}
										>Sign in with ChatGPT</button
									>
								{/if}
								{#if authMessage}<p class="auth-message" role="status">{authMessage}</p>{/if}
								<p class="provider-note">Credentials are encrypted and stored in this browser.</p>
							{/if}
						</div>
					{/if}
				</div>
			</div>
			<div class="account-actions">
				<button class="share-button" disabled={!activeChat} onclick={shareChat}>
					<svg viewBox="0 0 24 24" aria-hidden="true"
						><path d="M12 16V4" /><path d="m8 8 4-4 4 4" /><path
							d="M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-7"
						/></svg
					>
					{shareLabel}
				</button>
				<div class="account-control">
					{#if accountOpen}
						<button
							class="provider-backdrop"
							aria-label="Close account menu"
							onclick={() => (accountOpen = false)}
						></button>
					{/if}
					<button
						class="avatar"
						aria-label="Account and provider"
						aria-expanded={accountOpen}
						aria-haspopup="dialog"
						onclick={() => {
							accountOpen = !accountOpen;
							providerOpen = false;
						}}
					>
						<svg viewBox="0 0 24 24" aria-hidden="true"
							><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></svg
						>
					</button>
					{#if accountOpen}
						<div class="account-menu" role="dialog" aria-label="Account">
							<strong>{provider.type === 'oauth' ? 'ChatGPT' : 'Compatible API'}</strong>
							<div
								class:signed-in={provider.type === 'oauth' ? oauthSignedIn : providerReady}
								class="account-status"
							>
								<span></span>{provider.type === 'oauth'
									? oauthSignedIn
										? 'Connected'
										: 'Not connected'
									: providerReady
										? 'Configured'
										: 'Setup required'}
							</div>
							<p>
								{provider.type === 'oauth'
									? provider.oauthModel || 'No model selected'
									: provider.compatibleModel || 'No model selected'}
							</p>
							<button
								class="provider-primary"
								onclick={() => {
									accountOpen = false;
									providerOpen = true;
								}}>Provider settings</button
							>
							<button class="provider-secondary" onclick={openKnowledge}>Knowledge</button>
							{#if provider.type === 'oauth' && oauthSignedIn}
								<button class="provider-secondary" onclick={signOutOfChatGPT}>Sign out</button>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		</header>

		{#if knowledgeOpen}
			<button
				class="knowledge-backdrop"
				aria-label="Close knowledge manager"
				onclick={() => (knowledgeOpen = false)}
			></button>
			<div
				class="knowledge-dialog"
				role="dialog"
				aria-modal="true"
				aria-labelledby="knowledge-title"
			>
				<div class="knowledge-heading">
					<div>
						<h2 id="knowledge-title">Local knowledge</h2>
						<p>Private Markdown and text documents stored on this server.</p>
					</div>
					<button aria-label="Close knowledge manager" onclick={() => (knowledgeOpen = false)}
						>×</button
					>
				</div>

				<label class:disabled={knowledgeBusy} class="knowledge-upload">
					{knowledgeBusy ? 'Indexing…' : 'Add document'}
					<input
						type="file"
						accept=".md,.txt,text/markdown,text/plain"
						disabled={knowledgeBusy}
						onchange={uploadKnowledge}
					/>
				</label>
				<small>Maximum 250 KB. Re-uploading the same filename replaces it.</small>

				{#if knowledgeDocuments.length}
					<ul class="knowledge-list">
						{#each knowledgeDocuments as document (document.id)}
							<li>
								<div><strong>{document.name}</strong><span>{document.chunks} chunks</span></div>
								<button
									aria-label={`Delete ${document.name}`}
									disabled={knowledgeBusy}
									onclick={() => removeKnowledge(document)}>Delete</button
								>
							</li>
						{/each}
					</ul>
				{:else if !knowledgeMessage}
					<p class="knowledge-empty">No documents indexed yet.</p>
				{/if}
				{#if knowledgeMessage}<p class="knowledge-message" aria-live="polite">
						{knowledgeMessage}
					</p>{/if}
			</div>
		{/if}

		<div class:empty={!activeChat?.messages.length} class="conversation">
			<div class:empty={!activeChat?.messages.length} class="message-list">
				{#if !activeChat?.messages.length}
					<div class="welcome">
						<BotIcon large />
						<h1>How can I help you today?</h1>
					</div>
				{/if}

				{#each activeChat?.messages ?? [] as message, index (`${activeId}-${index}`)}
					{#if message.role === 'user'}
						<div class="user-row">
							<div class="user-content">
								<div class="user-message">{message.content}</div>
								{@render messageActions(message, index)}
							</div>
						</div>
					{:else}
						<div class="assistant-message">
							<BotIcon />
							<div class="assistant-content">
								{#if message.reasoning || (loading && index === activeChat!.messages.length - 1 && !message.content)}
									<details class="thinking">
										<summary>
											Thinking
											{#if loading && !message.content}
												<span class="thinking-dots" aria-hidden="true"
													><span></span><span></span><span></span></span
												>
											{/if}
										</summary>
										{#if message.reasoning}<div class="reasoning">{message.reasoning}</div>{/if}
									</details>
								{/if}
								{#if message.content}
									<div
										class:streaming={loading && index === activeChat!.messages.length - 1}
										class="answer"
										use:codeCopy
									>
										<!-- markdown-it escapes raw HTML; covered by markdown.test.ts -->
										<!-- eslint-disable-next-line svelte/no-at-html-tags -->
										{@html renderMarkdown(message.content)}
									</div>
									{@render messageActions(message, index)}
								{/if}
							</div>
						</div>
					{/if}
				{/each}
			</div>

			<form onsubmit={sendMessage}>
				<label for="prompt">Message GenieLM</label>
				<textarea
					id="prompt"
					bind:value={draft}
					rows="1"
					placeholder="Message GenieLM"
					onkeydown={(event) => {
						if (event.key === 'Enter' && !event.shiftKey) {
							event.preventDefault();
							event.currentTarget.form?.requestSubmit();
						}
					}}></textarea>
				{#if loading}
					<button type="button" aria-label="Stop responding" onclick={stopResponse}>
						<svg viewBox="0 0 24 24" aria-hidden="true"
							><rect
								x="8"
								y="8"
								width="8"
								height="8"
								rx="1"
								fill="currentColor"
								stroke="none"
							/></svg
						>
					</button>
				{:else}
					<button type="submit" aria-label="Send message" disabled={!draft.trim()}>
						<svg viewBox="0 0 24 24" aria-hidden="true"
							><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></svg
						>
					</button>
				{/if}
			</form>
		</div>
	</main>
</div>

<style>
	:global(*) {
		box-sizing: border-box;
	}
	:global(html:has(.knowledge-dialog)) {
		overflow: hidden;
	}
	button,
	input,
	textarea {
		font: inherit;
	}
	button {
		color: inherit;
	}

	.app-shell {
		display: grid;
		grid-template-columns: 204px 1fr;
		min-height: 100dvh;
		background: #f4f7f5;
		color: #155b6d;
		transition: grid-template-columns 0.2s ease;
	}
	.app-shell.sidebar-collapsed {
		grid-template-columns: 0 1fr;
	}
	.sidebar {
		position: sticky;
		top: 0;
		display: flex;
		flex-direction: column;
		align-self: start;
		height: 100dvh;
		overflow: hidden;
		padding: 24px 22px;
		background: #c1e4e1;
	}
	.sidebar-collapsed .sidebar {
		padding-inline: 0;
	}
	.sidebar-backdrop {
		display: none;
	}
	.sidebar-actions {
		display: flex;
		flex: none;
		justify-content: space-between;
		margin-bottom: 43px;
	}
	.sidebar nav {
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior-y: contain;
		margin-right: -22px;
		padding-right: 22px;
		scrollbar-color: #8fc4c0 transparent;
	}
	.icon-button,
	.open-sidebar,
	.share-button,
	.avatar,
	.history-group button {
		border: 0;
		background: none;
		cursor: pointer;
	}
	.icon-button svg {
		width: 25px;
		height: 25px;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.8;
	}
	.back-button {
		margin-left: -8px;
	}

	.history-group {
		margin-bottom: 20px;
	}
	.history-group h2 {
		margin: 0 0 14px;
		font-size: 14px;
		font-weight: 700;
	}
	.chat-item {
		position: relative;
		margin-bottom: 7px;
	}
	.chat-link {
		display: block;
		width: 100%;
		padding: 4px 28px 4px 5px;
		border-radius: 5px;
		text-align: left;
		font-size: 13px;
		line-height: 1.25;
	}
	.chat-link:hover,
	.chat-link.active {
		background: rgb(255 255 255 / 25%);
	}
	.remove-chat {
		position: absolute;
		top: 50%;
		right: 3px;
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border-radius: 5px;
		opacity: 0;
		transform: translateY(-50%);
	}
	.chat-item:hover .remove-chat,
	.chat-item:focus-within .remove-chat {
		opacity: 0.7;
	}
	.remove-chat:hover {
		background: rgb(255 255 255 / 45%);
		opacity: 1;
	}
	.remove-chat svg {
		width: 15px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	main {
		min-width: 0;
		min-height: 100dvh;
	}
	header {
		position: relative;
		z-index: 20;
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 90px;
		padding: 0 38px 0 30px;
	}
	.header-start,
	.brand {
		display: flex;
		align-items: center;
	}
	.provider-control {
		position: relative;
	}
	.brand {
		position: relative;
		z-index: 43;
		gap: 7px;
		padding: 0;
		border: 0;
		background: none;
		font-size: 26px;
		font-weight: 500;
		cursor: pointer;
	}
	.brand svg {
		width: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
		transition: transform 0.15s ease;
	}
	.brand[aria-expanded='true'] svg {
		transform: rotate(180deg);
	}
	.open-sidebar {
		margin-right: 15px;
		padding: 0;
		font-size: 20px;
	}
	.provider-backdrop {
		position: fixed;
		z-index: 40;
		inset: 0;
		border: 0;
		background: transparent;
	}
	.provider-menu {
		position: absolute;
		top: 43px;
		left: 0;
		z-index: 42;
		width: min(350px, calc(100vw - 32px));
		padding: 18px;
		border: 1px solid #bfd8d5;
		border-radius: 14px;
		background: #f9fbfa;
		box-shadow: 0 14px 40px rgb(21 91 109 / 16%);
		color: #155b6d;
	}
	.provider-tabs {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px;
		margin-bottom: 17px;
		padding: 3px;
		border-radius: 9px;
		background: #e3efed;
	}
	.provider-tabs button,
	.provider-primary,
	.provider-secondary {
		border: 0;
		border-radius: 7px;
		cursor: pointer;
	}
	.provider-tabs button {
		padding: 8px;
		background: transparent;
		font-size: 12px;
		font-weight: 650;
	}
	.provider-tabs button.active {
		background: white;
		box-shadow: 0 1px 4px rgb(21 91 109 / 12%);
	}
	.provider-menu label {
		display: block;
		margin-bottom: 13px;
		font-size: 12px;
		font-weight: 650;
	}
	.provider-menu label span {
		display: block;
		margin-bottom: 5px;
	}
	.provider-menu small {
		font-weight: 400;
		opacity: 0.7;
	}
	.provider-menu input {
		width: 100%;
		padding: 9px 10px;
		border: 1px solid #bfd8d5;
		border-radius: 8px;
		outline: none;
		background: white;
		color: #174f5e;
		font-size: 12px;
	}
	.provider-menu input:focus {
		border-color: #5da5a3;
		box-shadow: 0 0 0 2px rgb(93 165 163 / 15%);
	}
	.provider-primary,
	.provider-secondary {
		width: 100%;
		padding: 10px;
		font-size: 12px;
		font-weight: 700;
	}
	.provider-primary {
		background: #0da8aa;
		color: white;
	}
	.provider-primary:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.provider-secondary {
		margin-top: 7px;
		background: #e3efed;
	}
	.oauth-status {
		display: flex;
		align-items: center;
		gap: 7px;
		margin-bottom: 15px;
		font-size: 12px;
		font-weight: 650;
	}
	.oauth-status span {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #9aa8a7;
	}
	.oauth-status.signed-in span {
		background: #19a56f;
	}
	.auth-message,
	.provider-note {
		margin: 10px 0 0;
		font-size: 11px;
		line-height: 1.4;
	}
	.auth-message {
		color: #8d4a30;
	}
	.provider-note {
		opacity: 0.72;
	}
	.knowledge-backdrop {
		position: fixed;
		z-index: 50;
		inset: 0;
		border: 0;
		background: rgb(20 56 64 / 28%);
	}
	.knowledge-dialog {
		position: fixed;
		top: 50%;
		left: 50%;
		z-index: 51;
		width: min(520px, calc(100vw - 32px));
		max-height: min(650px, calc(100dvh - 32px));
		overflow-y: auto;
		padding: 22px;
		border: 1px solid #bfd8d5;
		border-radius: 16px;
		background: #f9fbfa;
		box-shadow: 0 18px 60px rgb(21 91 109 / 24%);
		transform: translate(-50%, -50%);
	}
	.knowledge-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 20px;
		margin-bottom: 18px;
	}
	.knowledge-heading h2,
	.knowledge-heading p {
		margin: 0;
	}
	.knowledge-heading h2 {
		font-size: 18px;
	}
	.knowledge-heading p,
	.knowledge-dialog small {
		color: #587b82;
		font-size: 11px;
	}
	.knowledge-heading p {
		margin-top: 4px;
	}
	.knowledge-heading button {
		padding: 0 3px;
		font-size: 24px;
		line-height: 1;
	}
	.knowledge-heading button,
	.knowledge-list button:not(:disabled) {
		cursor: pointer;
	}
	.knowledge-upload {
		display: block;
		width: 100%;
		padding: 10px;
		border-radius: 8px;
		background: #0da8aa;
		color: white;
		font-size: 12px;
		font-weight: 700;
		text-align: center;
		cursor: pointer;
	}
	.knowledge-upload.disabled {
		opacity: 0.5;
		cursor: default;
	}
	.knowledge-upload input {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		opacity: 0;
	}
	.knowledge-list {
		display: grid;
		gap: 7px;
		margin: 18px 0 0;
		padding: 0;
		list-style: none;
	}
	.knowledge-list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 12px;
		border: 1px solid #d5e3e1;
		border-radius: 8px;
		background: white;
	}
	.knowledge-list strong,
	.knowledge-list span {
		display: block;
	}
	.knowledge-list strong {
		font-size: 12px;
	}
	.knowledge-list span {
		margin-top: 2px;
		color: #6d8588;
		font-size: 10px;
	}
	.knowledge-list button {
		color: #8d4a30;
		font-size: 11px;
	}
	.knowledge-empty,
	.knowledge-message {
		margin: 18px 0 0;
		font-size: 12px;
	}
	.knowledge-message {
		color: #8d4a30;
	}
	.account-actions {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.account-control {
		position: relative;
	}
	.account-menu {
		position: absolute;
		top: 48px;
		right: 0;
		z-index: 42;
		width: 235px;
		padding: 17px;
		border: 1px solid #bfd8d5;
		border-radius: 14px;
		background: #f9fbfa;
		box-shadow: 0 14px 40px rgb(21 91 109 / 16%);
	}
	.account-menu strong {
		display: block;
		font-size: 14px;
	}
	.account-menu p {
		overflow: hidden;
		margin: 7px 0 15px;
		font-size: 12px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.account-status {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 5px;
		font-size: 11px;
	}
	.account-status span {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #9aa8a7;
	}
	.account-status.signed-in span {
		background: #19a56f;
	}
	.share-button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		min-width: 75px;
		padding: 7px 13px;
		border: 1px solid #b8cfce;
		border-radius: 18px;
		font-size: 12px;
		font-weight: 600;
	}
	.share-button:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.share-button svg {
		width: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
	}
	.avatar {
		position: relative;
		z-index: 43;
		display: grid;
		place-items: center;
		width: 37px;
		height: 37px;
		border-radius: 50%;
		background: #0da8aa;
		color: white;
	}
	.avatar svg {
		width: 19px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
	}

	.conversation {
		position: relative;
		display: flex;
		flex-direction: column;
		min-height: calc(100dvh - 90px);
		padding: 27px 34px 0;
	}
	.message-list {
		display: flex;
		flex: 1;
		flex-direction: column;
		width: min(860px, 100%);
		margin: 0 auto;
		padding-bottom: 72px;
	}
	.message-list.empty {
		flex: 0 0 auto;
		overflow: visible;
		justify-content: flex-start;
		padding-top: clamp(48px, 9vh, 90px);
		padding-bottom: 0;
	}
	.message-list.empty .welcome {
		margin: 0;
		padding-bottom: 0;
	}
	.conversation.empty form {
		position: relative;
		bottom: auto;
		left: auto;
		margin: 28px auto 0;
		padding-top: 0;
		transform: none;
	}
	.user-row {
		display: flex;
		justify-content: flex-end;
		margin: 0 0 39px;
	}
	.user-content {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		max-width: 70%;
		min-width: 0;
	}
	.user-message {
		padding: 15px 29px;
		border-radius: 28px;
		background: #b7e4e1;
		font-size: 14px;
	}
	.assistant-message {
		display: grid;
		grid-template-columns: 54px 1fr;
		align-items: start;
		margin-bottom: 38px;
	}
	.assistant-content {
		min-width: 0;
	}
	.message-actions {
		display: flex;
		gap: 3px;
		margin-top: 6px;
		opacity: 0;
		transition: opacity 0.15s ease;
	}
	.user-content:hover .message-actions,
	.user-content:focus-within .message-actions,
	.assistant-content:hover .message-actions,
	.assistant-content:focus-within .message-actions {
		opacity: 0.7;
	}
	.message-actions button {
		display: grid;
		place-items: center;
		width: 27px;
		height: 27px;
		padding: 0;
		border: 0;
		border-radius: 6px;
		background: transparent;
		cursor: pointer;
	}
	.message-actions button:hover,
	.message-actions button[aria-pressed='true'] {
		background: #dcecea;
		opacity: 1;
	}
	.message-actions button:disabled {
		cursor: default;
		opacity: 0.35;
	}
	.message-actions svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.message-actions svg rect {
		fill: none;
	}
	.message-actions button[aria-pressed='true'] svg rect {
		fill: currentColor;
		stroke: none;
	}
	.answer {
		min-width: 0;
		padding-top: 6px;
		font-size: 13px;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.answer :global(:first-child) {
		margin-top: 0;
	}
	.answer :global(:last-child) {
		margin-bottom: 0;
	}
	.answer :global(p) {
		margin: 0 0 12px;
	}
	.answer :global(h1),
	.answer :global(h2),
	.answer :global(h3),
	.answer :global(h4),
	.answer :global(h5),
	.answer :global(h6) {
		margin: 18px 0 9px;
		color: #104c5b;
		line-height: 1.2;
	}
	.answer :global(h1) {
		font-size: 22px;
	}
	.answer :global(h2) {
		font-size: 19px;
	}
	.answer :global(h3) {
		font-size: 16px;
	}
	.answer :global(ul),
	.answer :global(ol) {
		margin: 8px 0 14px;
		padding-left: 24px;
	}
	.answer :global(li) {
		margin: 4px 0;
	}
	.answer :global(a) {
		color: #087f83;
		font-weight: 600;
		text-underline-offset: 2px;
	}
	.answer :global(blockquote) {
		margin: 12px 0;
		padding: 3px 0 3px 13px;
		border-left: 3px solid #87c9c5;
		color: #39717c;
	}
	.answer :global(pre) {
		position: relative;
		margin: 12px 0;
		padding: 14px;
		border-radius: 8px;
		background: #163d48;
		color: #e6f5f3;
		font-size: 12px;
		line-height: 1.5;
	}
	.answer :global(pre > code) {
		display: block;
		overflow-x: auto;
	}
	.answer :global(.copy-code-holder) {
		position: sticky;
		top: 9px;
		z-index: 1;
		display: block;
		height: 0;
	}
	.answer :global(.copy-code) {
		position: absolute;
		top: 0;
		right: 0;
		padding: 4px 9px;
		border: 1px solid rgb(230 245 243 / 25%);
		border-radius: 5px;
		background: rgb(255 255 255 / 8%);
		color: #d9eeeb;
		font-family: 'Avenir Next', 'Segoe UI', Arial, sans-serif;
		font-size: 11px;
		cursor: pointer;
		opacity: 0;
	}
	.answer :global(pre:hover .copy-code),
	.answer :global(.copy-code:focus-visible) {
		opacity: 1;
	}
	.answer :global(.copy-code:hover),
	.answer :global(.copy-code:focus-visible) {
		background: rgb(255 255 255 / 16%);
		outline: none;
	}
	.answer :global(:not(pre) > code) {
		padding: 2px 5px;
		border-radius: 4px;
		background: #dcecea;
		color: #0b6068;
		font-size: 0.92em;
	}
	.answer :global(table) {
		display: block;
		width: 100%;
		overflow-x: auto;
		margin: 12px 0;
		border-collapse: collapse;
	}
	.answer :global(th),
	.answer :global(td) {
		padding: 7px 10px;
		border: 1px solid #b9d7d3;
		text-align: left;
	}
	.answer :global(th) {
		background: #dcecea;
	}
	.answer :global(hr) {
		margin: 18px 0;
		border: 0;
		border-top: 1px solid #bfd8d5;
	}
	.answer :global(.katex-block) {
		overflow-x: auto;
		margin: 16px 0;
		padding: 10px 0;
		text-align: center;
	}
	.answer :global(.katex-error) {
		color: #a33b35;
	}

	.answer.streaming :global(:last-child)::after {
		content: '';
		display: inline-block;
		width: 1px;
		height: 1em;
		margin-left: 3px;
		background: #155b6d;
		animation: blink 0.8s steps(1) infinite;
		vertical-align: -2px;
	}
	.thinking {
		padding-top: 8px;
		font-size: 13px;
	}
	.thinking summary {
		display: flex;
		width: fit-content;
		align-items: center;
		gap: 4px;
		font-weight: 600;
		cursor: pointer;
		list-style: none;
	}
	.thinking summary::-webkit-details-marker {
		display: none;
	}
	.thinking summary::before {
		content: '›';
		font-size: 18px;
		line-height: 0;
		transition: transform 0.15s ease;
	}
	.thinking[open] summary::before {
		transform: rotate(90deg);
	}
	.thinking-dots {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.thinking-dots span {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: currentColor;
		animation: think 1.2s ease-in-out infinite;
	}
	.thinking-dots span:nth-child(2) {
		animation-delay: 0.15s;
	}
	.thinking-dots span:nth-child(3) {
		animation-delay: 0.3s;
	}
	.reasoning {
		overflow-wrap: anywhere;
		margin: 8px 0 4px 5px;
		padding-left: 12px;
		border-left: 2px solid #b9d7d3;
		color: #45615e;
		font-weight: 400;
		line-height: 1.5;
		white-space: pre-wrap;
	}
	@keyframes blink {
		50% {
			opacity: 0;
		}
	}
	@keyframes think {
		50% {
			opacity: 0.25;
			transform: translateY(-2px);
		}
	}

	form {
		position: fixed;
		bottom: 18px;
		left: calc(50% + 102px);
		z-index: 10;
		width: min(680px, calc(100vw - 272px));
		margin: 0;
		padding: 0;
		transform: translateX(-50%);
		background: transparent;
	}
	.sidebar-collapsed form {
		left: 50%;
		width: min(680px, calc(100vw - 68px));
	}
	form label {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
	textarea {
		display: block;
		width: 100%;
		min-height: 50px;
		max-height: 150px;
		field-sizing: content;
		resize: none;
		padding: 14px 54px 12px 20px;
		border: 1px solid #bad2cf;
		border-radius: 25px;
		outline: 0;
		background: #f8faf9;
		color: #155b6d;
		font-size: 14px;
	}
	textarea:focus {
		border-color: #55aaa9;
		box-shadow: 0 0 0 2px #bce5e1;
	}
	form button {
		position: absolute;
		right: 8px;
		bottom: 7px;
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border: 0;
		border-radius: 50%;
		background: #0da8aa;
		color: white;
		cursor: pointer;
	}
	form button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	form button svg {
		width: 19px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.welcome {
		margin: auto 0;
		padding-bottom: 28px;
		text-align: center;
	}
	.welcome h1 {
		margin: 0;
		font-size: 25px;
		font-weight: 500;
	}

	@media (hover: none) {
		.remove-chat,
		.message-actions {
			opacity: 0.7;
		}
	}

	@media (max-width: 760px) {
		.app-shell,
		.app-shell.sidebar-collapsed {
			grid-template-columns: 1fr;
		}
		.sidebar {
			position: fixed;
			inset: 0 auto 0 0;
			z-index: 30;
			width: min(300px, 85vw);
			padding: 24px 22px;
			box-shadow: 10px 0 30px rgb(20 76 86 / 18%);
			transform: translateX(0);
			transition: transform 0.2s ease;
		}
		.sidebar-collapsed .sidebar {
			padding: 24px 22px;
			transform: translateX(-100%);
		}
		.sidebar-backdrop {
			position: fixed;
			inset: 0;
			z-index: 20;
			display: block;
			border: 0;
			background: rgb(10 52 61 / 24%);
		}
		header {
			height: 72px;
			padding: 0 18px;
		}
		.brand {
			font-size: 21px;
		}
		.conversation {
			min-height: calc(100dvh - 72px);
			padding: 18px 16px 0;
		}
		form,
		.sidebar-collapsed form {
			left: 50%;
			width: min(680px, calc(100vw - 32px));
		}
		.assistant-message {
			grid-template-columns: 48px 1fr;
		}
		.user-content {
			max-width: 88%;
		}
		.share-button {
			padding: 7px;
			font-size: 0;
		}
	}
</style>
