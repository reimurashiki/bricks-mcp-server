# Bricks Builder MCP Server

A Model Context Protocol (MCP) server that provides AI assistants with full access to [Bricks Builder](https://bricksbuilder.io) page content, enabling programmatic page building, template management, and element manipulation through natural language.

## Features

- **29 tools** for full Bricks Builder management
- Read, write, search, and manipulate Bricks page elements
- Template management with type filtering (header, footer, section, content, popup)
- **14 section generators** for common patterns (hero, features, pricing, FAQ, and more)
- Snapshot system for rollback before destructive changes
- Element tree view, bulk updates, move, and duplication
- Global classes and custom CSS management
- **Multi-site support**: manage multiple Bricks sites from one server instance
- **CPT support**: works with any custom post type, not just pages/posts
- Response trimming and pagination with totals

## Available Tools (29)

### Element Manipulation (10 tools)

| Tool | Description |
|------|-------------|
| `bricks_get_page_elements` | Get the Bricks elements array for a page/post by ID |
| `bricks_set_page_elements` | Set/replace the entire Bricks elements array |
| `bricks_add_element` | Add a single element with automatic parent-child linking and validation |
| `bricks_update_element` | Update a specific element's settings (shallow merge) |
| `bricks_remove_element` | Remove an element and all its descendants |
| `bricks_find_element` | Search elements by type, text content, or CSS class |
| `bricks_bulk_update_elements` | Update multiple elements at once with validation |
| `bricks_move_element` | Move element to a different parent or position |
| `bricks_duplicate_element` | Deep-clone element and descendants with new IDs |
| `bricks_get_element_tree` | Get hierarchical nested tree view of page structure |

### Snapshot / Rollback (4 tools)

| Tool | Description |
|------|-------------|
| `bricks_snapshot_page` | Save page state before making changes |
| `bricks_restore_snapshot` | Restore page elements from a saved snapshot |
| `bricks_list_snapshots` | List available snapshots for a page |
| `bricks_delete_snapshot` | Delete a specific snapshot |

### Template Management (5 tools)

| Tool | Description |
|------|-------------|
| `bricks_list_templates` | List templates with type filter (header/footer/section/content/popup) and search |
| `bricks_get_template` | Get template details including elements array |
| `bricks_create_template` | Create a new template with type and elements |
| `bricks_update_template` | Update template elements, title, or status |
| `bricks_delete_template` | Delete a template permanently |

### Page Management (3 tools)

| Tool | Description |
|------|-------------|
| `bricks_list_pages` | List pages with Bricks content (or all pages with `include_all`). Supports search. |
| `bricks_create_page` | Create a new page with Bricks content |
| `bricks_clone_page` | Clone a page's Bricks content with regenerated IDs (respects source CPT) |

### CSS & Styling (3 tools)

| Tool | Description |
|------|-------------|
| `bricks_get_global_classes` | Get Bricks global CSS classes |
| `bricks_get_page_css` | Get custom CSS for a page |
| `bricks_set_page_css` | Set custom CSS for a page |

### Local Helpers (3 tools -- no API calls)

| Tool | Description |
|------|-------------|
| `bricks_list_element_types` | List 24 available element types with defaults and examples |
| `bricks_generate_section` | Generate a complete section from 14 predefined patterns |
| `bricks_generate_element` | Generate a single Bricks element JSON |

### Site Settings (1 tool)

| Tool | Description |
|------|-------------|
| `bricks_get_settings` | Get Bricks global settings |

## Section Generator Patterns (14)

The `bricks_generate_section` tool creates complete, ready-to-use Bricks element structures:

| Type | What it generates |
|------|-------------------|
| `hero` | Heading + subtext + CTA button, centered layout |
| `features` | Section heading + grid of feature cards (configurable columns) |
| `pricing` | Pricing table with highlighted plan, features list, CTA buttons |
| `cta` | Dark background call-to-action with heading + text + button |
| `testimonials` | Grid of quote cards with author and role |
| `faq` | Heading + accordion with Q&A items |
| `contact` | Contact form with name, email, message fields |
| `stats` | Stats/numbers section (e.g., "10K+ Users", "99.9% Uptime") |
| `team` | Team grid with member cards (image + name + role) |
| `logos` | Logo cloud / client logos row |
| `newsletter` | Email signup with heading + input + button |
| `comparison` | Feature comparison table (2-3 columns with checkmarks) |
| `steps` | Process/how-it-works steps (numbered, with descriptions) |
| `footer` | Multi-column footer (about, links, contact, social) |

All patterns accept `overrides` to customize texts, colors, and structure.

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
3. **Tool usage**: Every tool accepts a `site` parameter. If omitted, the first configured site is used as default.

## CPT Support

All element and CSS tools accept a `post_type` parameter that defaults to `pages` but works with any registered custom post type (e.g., `posts`, `product`, `portfolio`).

## Response Format

List endpoints return paginated responses:

```json
{
  "data": [...],
  "total": 25,
  "total_pages": 1
}
```

## Changelog

### v2.0.0
- 29 tools (was 20): element search, snapshots, bulk update, move, duplicate, tree view, delete snapshot
- 14 section generators (was 6): contact, stats, team, logos, newsletter, comparison, steps, footer
- Enhanced list_pages (include_all, search) and list_templates (template_type filter, popup)
- Snapshot rollback system (save, restore, list, delete)
- Element validation with warnings
- Response trimming and pagination with totals
- CPT support for all element/CSS tools
- clonePage respects source post type
- createTemplate writes template_type to meta

### v1.0.0
- Initial release: 20 tools, multi-site support, 6 section generators

## Contributing

PRs welcome. Please open an issue first to discuss changes.

## License

MIT
