# Bricks Builder MCP Server

A Model Context Protocol (MCP) server that provides AI assistants with full access to [Bricks Builder](https://bricksbuilder.io) page content, enabling programmatic page building, template management, and element manipulation through natural language.

## Features

- Read and write Bricks page elements (the structured JSON that defines page layouts)
- Add, update, and remove individual elements on any page
- Template management (list, get, create, update, delete)
- Section generator for common patterns: hero, features, pricing, CTA, testimonials, FAQ
- Element type reference with default settings and examples
- Page listing, creation, and cloning with Bricks content
- Global classes and custom CSS management
- **Multi-site support**: manage multiple Bricks sites from one server instance

## Available Tools

| Tool | Description |
|------|-------------|
| `bricks_list_pages` | List all pages that have Bricks content |
| `bricks_get_page_elements` | Get the Bricks elements array for a page/post by ID |
| `bricks_set_page_elements` | Set/replace the entire Bricks elements array for a page/post |
| `bricks_add_element` | Add a single element to a page with automatic parent-child linking |
| `bricks_update_element` | Update a specific element's settings on a page (merges with existing) |
| `bricks_remove_element` | Remove an element and all its descendants from a page |
| `bricks_list_templates` | List all Bricks templates (headers, footers, sections, content) |
| `bricks_get_template` | Get template details including its Bricks elements array |
| `bricks_create_template` | Create a new Bricks template with elements |
| `bricks_update_template` | Update a Bricks template's elements, title, or status |
| `bricks_delete_template` | Delete a Bricks template permanently |
| `bricks_list_element_types` | List available element types with default settings and examples (local) |
| `bricks_generate_section` | Generate a complete section structure from a type: hero, features, pricing, cta, testimonials, faq (local) |
| `bricks_generate_element` | Generate a single Bricks element JSON from parameters (local) |
| `bricks_create_page` | Create a new WordPress page with Bricks content |
| `bricks_clone_page` | Clone a page's Bricks content to a new page with regenerated IDs |
| `bricks_get_global_classes` | Get Bricks global CSS classes |
| `bricks_get_page_css` | Get custom CSS for a page |
| `bricks_set_page_css` | Set custom CSS for a page |
| `bricks_get_settings` | Get Bricks global settings |

## Requirements

- Node.js 18+
- WordPress site with [Bricks Builder](https://bricksbuilder.io) theme installed and active
- WordPress Application Password

## Quick Setup

### 1. Clone and build

```bash
git clone https://github.com/sabiertas/bricks-mcp-server.git
cd bricks-mcp-server
npm install
npm run build
```

### 2. Configure in Claude Code

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "bricks": {
      "command": "node",
      "args": ["/path/to/bricks-mcp-server/dist/bricks-mcp-server.js"],
      "env": {
        "BRICKS_SITES": "main,staging",
        "BRICKS_MAIN_URL": "https://your-domain.com",
        "BRICKS_MAIN_USERNAME": "your-wp-username",
        "BRICKS_MAIN_PASSWORD": "your-application-password",
        "BRICKS_STAGING_URL": "https://staging.your-domain.com",
        "BRICKS_STAGING_USERNAME": "admin",
        "BRICKS_STAGING_PASSWORD": "your-application-password"
      }
    }
  }
}
```

### 3. Configure in Cursor / other MCP clients

Same config pattern -- see your client's MCP documentation.

## Authentication

Uses WordPress Application Passwords (Basic Auth). Create one at:
`WordPress Admin > Users > Profile > Application Passwords`

## Multi-site Support

This server supports managing multiple Bricks Builder sites simultaneously:

1. **`BRICKS_SITES`**: Comma-separated list of site identifiers (e.g., `main,staging,client`)
2. **Per-site variables**: For each site ID, set `BRICKS_{ID}_URL`, `BRICKS_{ID}_USERNAME`, and `BRICKS_{ID}_PASSWORD`
3. **Tool usage**: Every tool accepts a `site` parameter to specify which site to target. If omitted, the first configured site is used as default.

## Contributing

PRs welcome. Please open an issue first to discuss changes.

## License

MIT
