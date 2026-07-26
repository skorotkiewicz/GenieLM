<script lang="ts">
	import { renderMarkdown } from '$lib/markdown';
	import { onMount, tick } from 'svelte';

	type Message = { role: 'user' | 'assistant'; content: string };
	type Chat = { id: string; title: string; createdAt: number; messages: Message[] };
	type HistoryGroup = { label: string; chats: Chat[] };

	let chats = $state<Chat[]>([]);
	let activeId = $state<string | null>(null);
	let draft = $state('');
	let loading = $state(false);
	let loaded = $state(false);
	let sidebarOpen = $state(true);
	let conversation: HTMLDivElement;
	let abortController: AbortController | null = null;

	const activeChat = $derived(chats.find((chat) => chat.id === activeId));
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

		const restoreFromUrl = () => {
			const id = conversationIdFromUrl();
			activeId = chats.some((chat) => chat.id === id) ? id : null;
		};
		window.addEventListener('popstate', restoreFromUrl);
		loaded = true;
		return () => window.removeEventListener('popstate', restoreFromUrl);
	});

	$effect(() => {
		if (!loaded) return;
		localStorage.setItem('genielm-chats', JSON.stringify(chats));
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

	function newChat() {
		activeId = null;
		draft = '';
		setConversationUrl(null);
	}

	function selectChat(id: string) {
		activeId = id;
		setConversationUrl(id);
	}

	async function scrollToBottom() {
		await tick();
		conversation?.scrollTo({ top: conversation.scrollHeight, behavior: 'smooth' });
	}

	async function shareChat() {
		if (!activeChat) return;
		const text = activeChat.messages
			.map((message) => `${message.role === 'user' ? 'You' : 'GenieLM'}: ${message.content}`)
			.join('\n\n');
		if (navigator.share) await navigator.share({ title: activeChat.title, text });
		else await navigator.clipboard.writeText(text);
	}

	function stopResponse() {
		abortController?.abort();
	}

	async function sendMessage(event: SubmitEvent) {
		event.preventDefault();
		const content = draft.trim();
		if (!content || loading) return;

		let chat = activeChat;
		if (!chat) {
			const id = crypto.randomUUID();
			chats = [{ id, title: content.slice(0, 48), createdAt: Date.now(), messages: [] }, ...chats];
			activeId = id;
			setConversationUrl(id, true);
			chat = chats[0];
		}

		const requestMessages = [...chat.messages, { role: 'user', content } satisfies Message];
		chat.messages.push({ role: 'user', content }, { role: 'assistant', content: '' });
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
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					messages: requestMessages.map((message, index) => ({
						id: `${chat.id}-${index}`,
						role: message.role,
						parts: [{ type: 'text', text: message.content }]
					}))
				})
			});
			if (!response.ok || !response.body) throw new Error('Request failed');

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				chat.messages[answerIndex].content += decoder.decode(value, { stream: true });
				await scrollToBottom();
			}
			if (!chat.messages[answerIndex].content) throw new Error('Empty response');
		} catch {
			if (controller.signal.aborted) {
				if (!chat.messages[answerIndex].content) {
					chat.messages[answerIndex].content = 'Response stopped.';
				}
			} else {
				chat.messages[answerIndex].content =
					'Sorry, I could not reach the local model. Please try again.';
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
						<button class:active={chat.id === activeId} onclick={() => selectChat(chat.id)}
							>{chat.title}</button
						>
					{/each}
				</section>
			{/each}
		</nav>
	</aside>

	<main>
		<header>
			<div class="brand">
				{#if !sidebarOpen}<button
						class="open-sidebar"
						aria-label="Open sidebar"
						onclick={() => (sidebarOpen = true)}>☰</button
					>{/if}
				<span>GenieLM</span>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
			</div>
			<div class="account-actions">
				<button class="share-button" disabled={!activeChat} onclick={shareChat}>
					<svg viewBox="0 0 24 24" aria-hidden="true"
						><path d="M12 16V4" /><path d="m8 8 4-4 4 4" /><path
							d="M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-7"
						/></svg
					>
					Share
				</button>
				<button class="avatar" aria-label="Account">BB</button>
			</div>
		</header>

		<div class="conversation" bind:this={conversation}>
			<div class:empty={!activeChat?.messages.length} class="message-list">
				{#if !activeChat?.messages.length}
					<div class="welcome">
						<div class="bot-icon large"><span></span></div>
						<h1>How can I help you today?</h1>
					</div>
				{/if}

				{#each activeChat?.messages ?? [] as message, index (`${activeId}-${index}`)}
					{#if message.role === 'user'}
						<div class="user-row"><div class="user-message">{message.content}</div></div>
					{:else}
						<div class="assistant-message">
							<div class="bot-icon"><span></span></div>
							{#if loading && index === activeChat!.messages.length - 1 && !message.content}
								<div class="thinking" role="status">
									Thinking<span></span><span></span><span></span>
								</div>
							{:else}
								<div
									class:streaming={loading && index === activeChat!.messages.length - 1}
									class="answer"
								>
									<!-- markdown-it escapes raw HTML; covered by markdown.test.ts -->
									<!-- eslint-disable-next-line svelte/no-at-html-tags -->
									{@html renderMarkdown(message.content)}
								</div>
							{/if}
						</div>
					{/if}
				{/each}

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
		</div>
	</main>
</div>

<style>
	:global(*) {
		box-sizing: border-box;
	}
	button,
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
		overflow: hidden auto;
		padding: 24px 22px;
		background: #c1e4e1;
	}
	.sidebar-collapsed .sidebar {
		padding-inline: 0;
	}
	.sidebar-actions {
		display: flex;
		justify-content: space-between;
		margin-bottom: 43px;
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
	.history-group button {
		display: block;
		width: 100%;
		margin: 0 0 7px;
		padding: 4px 5px;
		border-radius: 5px;
		text-align: left;
		font-size: 13px;
		line-height: 1.25;
	}
	.history-group button:hover,
	.history-group button.active {
		background: rgb(255 255 255 / 25%);
	}

	main {
		min-width: 0;
		height: 100dvh;
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 90px;
		padding: 0 38px 0 30px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 26px;
		font-weight: 500;
	}
	.brand svg {
		width: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
	}
	.open-sidebar {
		margin-right: 8px;
		padding: 0;
		font-size: 20px;
	}
	.account-actions {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.share-button {
		display: flex;
		align-items: center;
		gap: 5px;
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
		width: 37px;
		height: 37px;
		border-radius: 50%;
		background: #0da8aa;
		color: white;
		font-size: 13px;
		font-weight: 700;
	}

	.conversation {
		height: calc(100dvh - 90px);
		overflow-y: auto;
		padding: 27px 34px 34px;
		scrollbar-color: #c6d3d0 transparent;
	}
	.message-list {
		display: flex;
		flex-direction: column;
		width: min(860px, 100%);
		min-height: 100%;
		margin: 0 auto;
	}
	.message-list.empty {
		justify-content: center;
	}
	.user-row {
		display: flex;
		justify-content: flex-end;
		margin: 0 0 39px;
	}
	.user-message {
		max-width: 70%;
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
		overflow-x: auto;
		margin: 12px 0;
		padding: 14px;
		border-radius: 8px;
		background: #163d48;
		color: #e6f5f3;
		font-size: 12px;
		line-height: 1.5;
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

	.bot-icon {
		position: relative;
		width: 41px;
		height: 37px;
		margin-top: 1px;
		border: 2px solid #377083;
		border-radius: 48% 48% 43% 43%;
	}
	.bot-icon::before,
	.bot-icon::after {
		content: '';
		position: absolute;
		top: 15px;
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: #377083;
	}
	.bot-icon::before {
		left: 9px;
	}
	.bot-icon::after {
		right: 9px;
	}
	.bot-icon span::before {
		content: '';
		position: absolute;
		top: -10px;
		left: 19px;
		width: 2px;
		height: 9px;
		background: #377083;
		transform: rotate(16deg);
	}
	.bot-icon span::after {
		content: '';
		position: absolute;
		top: -13px;
		left: 19px;
		width: 5px;
		height: 5px;
		border: 2px solid #377083;
		border-radius: 50%;
	}
	.bot-icon {
		box-shadow:
			-5px 12px 0 -4px #f4f7f5,
			-7px 12px 0 -5px #377083,
			5px 12px 0 -4px #f4f7f5,
			7px 12px 0 -5px #377083;
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
		display: flex;
		align-items: center;
		gap: 4px;
		padding-top: 8px;
		font-size: 13px;
		font-weight: 600;
	}
	.thinking span {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: currentColor;
		animation: think 1.2s ease-in-out infinite;
	}
	.thinking span:nth-child(2) {
		animation-delay: 0.15s;
	}
	.thinking span:nth-child(3) {
		animation-delay: 0.3s;
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
		position: relative;
		width: min(680px, 90%);
		margin: auto auto 0;
		padding-top: 28px;
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
		resize: vertical;
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
	.welcome .bot-icon {
		margin: 0 auto 25px;
		transform: scale(1.25);
	}
	.welcome h1 {
		margin: 0;
		font-size: 25px;
		font-weight: 500;
	}

	@media (max-width: 760px) {
		.app-shell,
		.app-shell.sidebar-collapsed {
			grid-template-columns: 1fr;
		}
		.sidebar {
			display: none;
		}
		header {
			height: 72px;
			padding: 0 18px;
		}
		.brand {
			font-size: 21px;
		}
		.conversation {
			height: calc(100dvh - 72px);
			padding: 18px 16px 25px;
		}
		.assistant-message {
			grid-template-columns: 48px 1fr;
		}
		.user-message {
			max-width: 88%;
		}
		.share-button {
			padding: 7px;
			font-size: 0;
		}
	}
</style>
