// Turns an icon set's nodes ([tag, attributes] pairs, like Lucide's) into a component drawn by the
// native <Svg>. Every icon set in this package goes through it.
import { defineComponent, h, type PropType, type Style, type SvgElement } from 'vue'

const VIEW_BOX: [number, number, number, number] = [0, 0, 24, 24]

export function createIcon(name: string, iconNode: readonly (readonly [string, object])[]) {
  const elements = iconNode as SvgElement[]

  return defineComponent({
    name: `${name}Icon`,
    props: {
      size: { type: Number, default: 24 },
      color: { type: String, default: '#000000' },
      strokeWidth: { type: Number, default: 2 },
      // Like Lucide's: the stroke keeps its width in points whatever the size.
      absoluteStrokeWidth: Boolean,
      style: Object as PropType<Style>,
    },

    setup(props) {
      return () =>
        h('Svg', {
          viewBox: VIEW_BOX,
          elements,
          color: props.color,
          strokeWidth: props.absoluteStrokeWidth
            ? (props.strokeWidth * VIEW_BOX[2]) / props.size
            : props.strokeWidth,
          style: { width: props.size, height: props.size, ...props.style },
        })
    },
  })
}
