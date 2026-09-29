export function reactTodoFiles() {
  return {
    "package.json": JSON.stringify({
      name: "jazz-react-todo",
      private: true,
      version: "0.1.0",
      type: "module",
      scripts: {
        dev: "vite",
        build: "vite build",
        preview: "vite preview"
      },
      dependencies: {
        react: "18.3.1",
        "react-dom": "18.3.1"
      },
      devDependencies: {
        "@vitejs/plugin-react": "4.3.4",
        vite: "6.0.7"
      }
    }, null, 2) + "\n",
    "index.html": `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>Jazz Todo</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.jsx"></script>\n  </body>\n</html>\n`,
    "src/main.jsx": `import React from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App.jsx";\nimport "./styles.css";\n\ncreateRoot(document.getElementById("root")).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>\n);\n`,
    "src/App.jsx": `import { useMemo, useState } from "react";\n\nexport default function App() {\n  const [items, setItems] = useState([]);\n  const [text, setText] = useState("");\n\n  const remaining = useMemo(() => items.filter(item => !item.done).length, [items]);\n\n  function addTodo(event) {\n    event.preventDefault();\n    const title = text.trim();\n    if (!title) return;\n    setItems(current => [...current, { id: crypto.randomUUID(), title, done: false }]);\n    setText("");\n  }\n\n  function toggleTodo(id) {\n    setItems(current => current.map(item => item.id === id ? { ...item, done: !item.done } : item));\n  }\n\n  function removeTodo(id) {\n    setItems(current => current.filter(item => item.id !== id));\n  }\n\n  return (\n    <main className="shell">\n      <section className="card">\n        <p className="eyebrow">Jazz Coding Agent</p>\n        <h1>Todo list</h1>\n        <p className="subtle">{remaining} task{remaining === 1 ? "" : "s"} remaining</p>\n\n        <form onSubmit={addTodo} className="composer">\n          <input\n            value={text}\n            onChange={event => setText(event.target.value)}\n            placeholder="What needs to be done?"\n            aria-label="New todo"\n          />\n          <button type="submit">Add</button>\n        </form>\n\n        <ul className="list">\n          {items.map(item => (\n            <li key={item.id} className={item.done ? "done" : ""}>\n              <label>\n                <input type="checkbox" checked={item.done} onChange={() => toggleTodo(item.id)} />\n                <span>{item.title}</span>\n              </label>\n              <button className="remove" onClick={() => removeTodo(item.id)} aria-label={\`Remove ${item.title}\`}>×</button>\n            </li>\n          ))}\n        </ul>\n\n        {items.length === 0 && <p className="empty">No tasks yet. Add your first one.</p>}\n      </section>\n    </main>\n  );\n}\n`,
    "src/styles.css": `:root { font-family: Inter, system-ui, sans-serif; color: #18212f; background: #eef2f7; }\n* { box-sizing: border-box; }\nbody { margin: 0; min-width: 320px; min-height: 100vh; }\nbutton, input { font: inherit; }\n.shell { min-height: 100vh; display: grid; place-items: center; padding: 24px; }\n.card { width: min(680px, 100%); background: white; border-radius: 24px; padding: 32px; box-shadow: 0 20px 60px rgba(15, 23, 42, 0.12); }\n.eyebrow { margin: 0 0 8px; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }\nh1 { margin: 0; font-size: clamp(32px, 7vw, 52px); }\n.subtle, .empty { color: #667085; }\n.composer { display: grid; grid-template-columns: 1fr auto; gap: 10px; margin: 28px 0 20px; }\n.composer input { min-width: 0; padding: 14px 16px; border: 1px solid #d0d5dd; border-radius: 12px; }\n.composer button, .remove { border: 0; border-radius: 12px; cursor: pointer; }\n.composer button { padding: 0 20px; background: #111827; color: white; font-weight: 700; }\n.list { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }\n.list li { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 16px; border: 1px solid #eaecf0; border-radius: 14px; }\n.list label { display: flex; align-items: center; gap: 12px; min-width: 0; }\n.list span { overflow-wrap: anywhere; }\n.list .done span { color: #98a2b3; text-decoration: line-through; }\n.remove { width: 34px; height: 34px; background: #f2f4f7; }\n@media (max-width: 520px) { .card { padding: 22px; } .composer { grid-template-columns: 1fr; } .composer button { min-height: 46px; } }\n`,
    "README.md": `# Jazz React Todo\n\nGenerated in an isolated Jazz Coding Agent workspace.\n\n## Run\n\n\`\`\`bash\npnpm install\npnpm dev\n\`\`\`\n\nThe main Jazz repository is not modified by this generated application.\n`
  };
}
