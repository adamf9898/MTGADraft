<template>
	<component :is="tag" :class="classes">
		<slot v-if="loaded || (img && img.src && img.complete)"><img :src="src" /></slot>
		<slot name="placeholder" v-else></slot>
	</component>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
/**
 * Modified to test visibility on creation and avoid flickering when the image is already in cache.
 * 15/03/2023: Translated to Typescript
 **/

/*!
 * Vue Clazy Load
 * Component-based lazy (CLazy) load images in Vue.js 2
 * @author Matheus Grieger
 * @version 0.4.2
 */
export default defineComponent({
	name: "ClazyLoad",
	props: {
		/**
		 * HTML/Component tag name to be used in place of the component
		 * @type {String}
		 * @default div
		 */
		tag: { type: String, default: "div" },

		/**
		 * Forces immediate loading
		 * @type {Boolean}
		 * @default false
		 */
		forceLoad: { type: Boolean, default: false },

		/**
		 * Image source URL
		 * @type {String}
		 * @required
		 */
		src: { type: String, required: true },

		/**
		 * IntersectionObserver root element
		 * @type {String}
		 */
		element: String,

		/**
		 * IntersectionObserver threshold
		 * @type {Array, Number}
		 */
		threshold: {
			type: [Array, Number] as PropType<number | number[]>,
			default: [0, 0.5, 1],
		},

		/**
		 * InserectionObserver visibility ratio
		 * @type {Number}
		 */
		ratio: {
			type: Number,
			default: 0.4,
			// can't be less than 0 and greater than 1
			validator: (value: number) => value >= 0 && value <= 1,
		},

		/**
		 * IntersectionObserver root margin
		 * @type {String}
		 */
		margin: { type: String, default: "0px" },

		/**
		 * Optional CORS mode ("anonymous" | "use-credentials")
		 * @see https://developer.mozilla.org/en-US/docs/Web/HTML/CORS_enabled_image
		 * @see
		 * https://developer.mozilla.org/en-US/docs/Web/HTML/Element/img#attr-crossorigin
		 * @type {String}
		 */
		crossorigin: {
			type: String as PropType<"anonymous" | "use-credentials">,
			default: null,
			validator: (value: string) => value === "anonymous" || value === "use-credentials",
		},

		/**
		 * Class added to element when it finishes loading
		 * @type {String}
		 * @default loaded
		 */
		loadedClass: { type: String, default: "loaded" },

		/**
		 * Class added to element while it is loading
		 * @type {String}
		 */
		loadingClass: { type: String, default: "loading" },

		/**
		 * Class added to element if loading failed
		 * @type {String}
		 */
		errorClass: { type: String, default: null },
	},
	data: () => {
		return {
			loaded: false,
			img: new Image() as HTMLImageElement | null,
			observer: null as IntersectionObserver | null,
			errored: false,
		};
	},
	methods: {
		isVisible() {
			const rect = this.$el.getBoundingClientRect();

			return (
				rect.top <= (window.innerHeight || document.documentElement.clientHeight) &&
				rect.left <= (window.innerWidth || document.documentElement.clientWidth) &&
				rect.bottom >= 0 &&
				rect.right >= 0
			);
		},
		/**
		 * Start loading image
		 */
		load() {
			this.$emit("loading");

			// disconnect observer so it doesn't load more than once
			if (this.observer) this.observer.disconnect();

			if (!this.loaded) {
				// function used to clear variables from memory
				const clear = () => {
					this.img = null; // discard fake image
					this.observer = null; // remove observer from memory
				};

				this.img!.addEventListener("load", () => {
					this.loaded = true;
					//this.$forceUpdate();
					this.$emit("load"); // emits 'load' event upwards
					clear();
				});
				this.img!.addEventListener("error", (event) => {
					this.errored = true;
					// emits 'error' event upwards adds the original event as argument
					this.$emit("error", event);
					clear();
				});

				// CORS mode configuration
				if (this.crossorigin !== null) this.img!.crossOrigin = this.crossorigin;

				this.img!.src = this.src;
			}
		},

		/**
		 * Creates IntersectionObserver instance and observe current element
		 */
		observe() {
			const options = {
				threshold: this.threshold,
				root: this.element ? document.querySelector(this.element) : null,
				rootMargin: this.margin, // creates IO instance
			};
			this.observer = new IntersectionObserver((entries) => {
				// as we instantiated one for each component we can directly access the first index
				if (
					(this.ratio === 0 && entries[0].isIntersecting) ||
					(this.ratio > 0 && entries[0].intersectionRatio >= this.ratio)
				)
					this.load();
			}, options); // start observing main component

			this.observer.observe(this.$el);
		},
	},
	mounted() {
		// Immediatly load if visible
		if (this.isVisible() || this.forceLoad) {
			this.img!.src = this.src;
			this.loaded = this.img!.complete; // The image may already be in cache
			if (!this.loaded) this.load();
			this.$forceUpdate();
		} else {
			// start observing the element visibility
			this.$nextTick(this.observe);
		}
	},
	computed: {
		classes() {
			const elementClass = this.loaded ? this.loadedClass : this.loadingClass;
			return this.errored && this.errorClass ? this.errorClass : elementClass;
		},
	},
});
</script>
