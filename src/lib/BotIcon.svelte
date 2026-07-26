<script lang="ts">
	let { large = false } = $props<{ large?: boolean }>();
</script>

<svg class:large class="bot-icon" viewBox="0 0 64 64" aria-hidden="true">
	<path
		d="M16 22c3-6 9-9 17-9h8c10 0 17 8 17 19v3c0 8-4 14-11 18 0 4 1 7 4 10-6-1-11-4-15-8h-4c-12 0-21-8-21-20v-3c0-4 1-7 3-10"
	/>
	<path d="M12 25c-4 1-6 4-6 9v5c0 5 2 8 6 9M57 25c4 1 6 4 6 9v5c0 5-2 8-6 9" />
	<path d="M29 13c-4-5-1-11 5-11 4 0 7 3 6 6-1 3-4 5-8 5" />
	<circle cx="26" cy="34" r="2.5" class="eye" />
	<circle cx="43" cy="34" r="2.5" class="eye" />
	<path d="M29 43c4 3 9 2 12-2" />
</svg>

<style>
	.bot-icon {
		display: block;
		width: 44px;
		height: 44px;
		margin-top: -2px;
		overflow: visible;
		fill: none;
		stroke: #377083;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.bot-icon.large {
		width: 55px;
		height: 55px;
		margin: 0 auto 22px;
	}
	.eye {
		fill: #377083;
		stroke: none;
	}
</style>
