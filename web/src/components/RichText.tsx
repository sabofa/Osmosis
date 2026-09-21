import { useMemo } from 'react'
import { render } from '../lib/richText'
import './RichText.css'

// The single place in the app allowed to use dangerouslySetInnerHTML: the HTML
// comes from richText.render, which escapes every text segment itself and only
// otherwise emits katex's own markup (rendered with trust:false).
export default function RichText({
  text,
  inline = false,
  className,
}: {
  text: string
  inline?: boolean
  className?: string
}) {
  const html = useMemo(() => render(text), [text])
  const props = {
    className: className ? `rich-text ${className}` : 'rich-text',
    dangerouslySetInnerHTML: { __html: html },
  }
  return inline ? <span {...props} /> : <div {...props} />
}
