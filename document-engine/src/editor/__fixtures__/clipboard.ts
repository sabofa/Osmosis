// Small hand-written clipboard HTML snippets in the shapes Word, Google Docs
// and web pages put on the clipboard. Not taken from any real document.

export const WORD_MIXED = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset=utf-8><meta name=Generator content="Microsoft Word 15">
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Normal</w:View></w:WordDocument></xml><![endif]-->
<style><!-- p.MsoNormal {margin:0in} --></style></head>
<body lang=EN-US style='tab-interval:.5in'>
<!--StartFragment-->
<p class=MsoTitle>Field Notes</p>
<p class=MsoHeading2>Method</p>
<p class=MsoNormal>It was a <span style='font-weight:bold'>careful</span>, <span style='font-style:italic'>slow</span> run &mdash; the &#8220;best&#8221; so far.<o:p></o:p></p>
<p class=MsoNormal><o:p>&nbsp;</o:p></p>
<p class=MsoListParagraphCxSpFirst style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-fareast-font-family:Symbol;mso-bidi-font-family:Symbol'><span style='mso-list:Ignore'>&middot;<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Apples<o:p></o:p></p>
<p class=MsoListParagraphCxSpMiddle style='text-indent:-.25in;mso-list:l0 level2 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>o<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span><![endif]>Granny Smith<o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>&middot;<span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span><![endif]>Pears<o:p></o:p></p>
<p class=MsoListParagraphCxSpFirst style='text-indent:-.25in;mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>1.<span>&nbsp;&nbsp;&nbsp; </span></span><![endif]>Mix<o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='text-indent:-.25in;mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>2.<span>&nbsp;&nbsp;&nbsp; </span></span><![endif]>Bake<o:p></o:p></p>
<p class=MsoNormal>See <a href="https://example.com/recipe"><span style='color:#0563C1'>the recipe</span></a> for more.</p>
<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0>
<tr><td width=100><p class=MsoNormal>Item</p></td><td width=100><p class=MsoNormal style='text-align:right'>Qty</p></td></tr>
<tr><td width=100><p class=MsoNormal>Apples</p></td><td width=100><p class=MsoNormal style='text-align:right'>3</p></td></tr>
</table>
<p class=MsoNormal><img width=40 height=40 src="file:///C:/Users/x/AppData/Local/Temp/msohtmlclip1/01/clip_image001.png" alt="Chart of results"></p>
<p class=MsoNormal><img src="cid:image001.png@01D" alt=""></p>
<!--EndFragment-->
</body></html>`

export const GDOCS_BOLD_WRAPPER = `<meta charset='utf-8'><meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b3c4d-7fff-1111-2222-333344445555"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial;font-weight:400;">Plain start, </span><span style="font-size:11pt;font-weight:700;">bold part</span><span style="font-size:11pt;font-style:italic;"> and italic.</span></p><ul style="margin-top:0;margin-bottom:0;"><li dir="ltr" style="list-style-type:disc;"><p dir="ltr" role="presentation"><span style="font-weight:400;">One</span></p></li><li dir="ltr" style="list-style-type:disc;"><p dir="ltr" role="presentation"><span style="font-weight:400;">Two</span></p></li></ul></b>`

export const WEB_ARTICLE = `<html><head><title>Post</title><style>.x{color:red}</style><script>var a = 1;</script></head><body>
<nav><ul><li><a href="/">Home</a></li><li><a href="/about">About</a></li></ul></nav>
<article>
<h2>Why _snake_case_ wins</h2>
<p>Read the <a href="https://example.org/spec">spec</a> and the <em>notes</em>; costs $5 or $10.</p>
<blockquote><p>Names matter.</p></blockquote>
<ul><li>First</li><li>Second<ul><li>Nested</li></ul></li></ul>
<ol><li>One</li><li>Two</li></ol>
<script>track()</script>
<form><input type="text"><button>Subscribe</button></form>
</article>
<aside>Related posts</aside>
<footer><p>Copyright 2026</p></footer>
<svg><path d="M0 0"/></svg>
</body></html>`

export const PLAIN_TEXT_IN_DIV = `<meta charset='utf-8'><div style="color: rgb(0, 0, 0); font-family: Arial;">just some copied words, nothing fancy</div>`
export const PLAIN_TEXT_IN_SPAN = `<span style="color:#111">hello world</span>`

export const MARKDOWN_TEXT = '# Title\n\n- one\n- two\n\n1. first\n2. second'
export const MARKDOWN_AS_VSCODE_HTML = `<meta charset='utf-8'><div style="color:#d4d4d4;background-color:#1e1e1e;font-family:Consolas;white-space:pre"><div><span style="color:#569cd6"># Title</span></div><div><span style="color:#d4d4d4">- one</span></div></div>`

export const CODE_BLOCK = `<h3>Example</h3><pre><code class="language-ts">const a = 1;\n\nif (a &lt; 2) {\n  run();\n}\n</code></pre><p>Use <code>run()</code> here.</p>`
export const PRE_NO_CODE = `<pre class="highlight"><span class="k">def</span> f():\n    return 1</pre>`

export const TABLE_ALIGNED = `<table><thead><tr><th style="text-align:left">Name</th><th align="center">Score</th><th style="text-align: right">Pct</th></tr></thead><tbody><tr><td>Ann</td><td>9</td><td>90%</td></tr><tr><td>Bo | Jr</td><td>7</td><td>70%</td></tr></tbody></table>`

export const IMAGES = `<p><img src="https://example.com/a.png" alt="Remote"> <img src="file:///C:/tmp/b.png" alt="Local pic"> <img src="data:image/png;base64,${'A'.repeat(3000)}" alt="Huge"> <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Tiny"> <img src="cid:zzz"></p>`
