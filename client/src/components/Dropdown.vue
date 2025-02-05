<template>
	<span class="dropdown-container" @mouseenter="updateHeight" :class="{ 'forced-open': forcedOpen }">
		<div class="handle" @pointerdown="toggleKeepOpen"><slot name="handle"></slot></div>
		<div class="dropdown">
			<div class="content" ref="content">
				<slot name="dropdown"></slot>
			</div>
		</div>
	</span>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
	data() {
		return { forcedOpen: false };
	},
	props: {
		minwidth: { type: String, default: "12em" },
	},
	mounted() {
		this.updateHeight();
	},
	methods: {
		updateHeight() {
			this.$el.setAttribute(
				"style",
				`--unrolled-height: calc(1em + ${(this.$refs.content as HTMLElement).clientHeight}px); --min-width: ${
					this.minwidth
				}`
			);
		},
		toggleKeepOpen() {
			this.setKeepOpen(!this.forcedOpen);
		},
		setKeepOpen(open: boolean) {
			if (this.forcedOpen === open) return;
			this.forcedOpen = open;
			if (this.forcedOpen) {
				this.$el.addEventListener("pointerdown", this.stopPropagation);
				document.addEventListener("pointerdown", this.onOutsideClick, { once: true });
			} else {
				this.$el.removeEventListener("pointerdown", this.stopPropagation);
				document.removeEventListener("pointerdown", this.onOutsideClick);
			}
			this.updateHeight();
		},
		onOutsideClick() {
			this.setKeepOpen(false);
		},
		stopPropagation(e: Event) {
			e.stopPropagation();
		},
	},
});
</script>

<style scoped>
.dropdown-container {
	position: relative;
	display: inline-block;
	background-color: #444;
	border-radius: 8px 8px 0 0;
	box-shadow: 0 2px 4px 0 #444;
	min-width: var(--min-width);

	--min-width: 12em;
	--unrolled-height: 500px;
}

.handle {
	margin: 0.25em 0.5em;
	text-align: center;
}

.handle span {
	margin: 0 0.25em;
}

.dropdown {
	position: absolute;
	top: 100%;
	z-index: 1;
	background-color: #444;
	width: 100%;
	box-sizing: border-box;
	border-radius: 0 0 8px 8px;
	max-height: 0;
	overflow: hidden;
	transition: all 0.2s ease-in-out;
	text-align: center;
}

.handle::after {
	position: absolute;
	font-family: "Mini Font Awesome 5 Free";
	font-weight: 900;
	content: "\f0d7";
	right: 5px;
	bottom: -7px;
	transition: transform 0.2s ease;
}

.forced-open .handle::after {
	transform: rotate(180deg);
}

.forced-open .dropdown {
	max-height: var(--unrolled-height);
	box-shadow: 0 8px 8px 1px rgba(0, 0, 0, 0.5);
	z-index: 1;
}

@media (any-hover: hover) {
	.dropdown-container:hover .handle::after {
		transform: rotate(180deg);
	}
	.dropdown-container:hover .dropdown {
		max-height: var(--unrolled-height);
		box-shadow: 0 8px 8px 1px rgba(0, 0, 0, 0.5);
		z-index: 1;
	}
}

.content {
	margin: 0.5em;
	display: flex;
	flex-direction: column;
}
</style>
