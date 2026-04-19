<?php
/**
 * Plugin Name: Bricks MCP Meta Bridge
 * Description: Exposes a secure REST bridge for reading/writing Bricks page elements in post meta for MCP integrations.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) {
    exit;
}

function bricks_mcp_normalize_post_type($post_type) {
    $value = strtolower(trim((string) $post_type));
    if ($value === 'page' || $value === 'pages' || $value === '') return 'page';
    if ($value === 'post' || $value === 'posts') return 'post';
    return $value;
}

function bricks_mcp_get_editor_mode_key() {
    return defined('BRICKS_DB_EDITOR_MODE') && is_string(BRICKS_DB_EDITOR_MODE)
        ? BRICKS_DB_EDITOR_MODE
        : '_bricks_editor_mode';
}

function bricks_mcp_get_page_settings_key() {
    return defined('BRICKS_DB_PAGE_SETTINGS') && is_string(BRICKS_DB_PAGE_SETTINGS)
        ? BRICKS_DB_PAGE_SETTINGS
        : '_bricks_page_settings';
}

function bricks_mcp_resolve_elements_meta_key($post_id) {
    $template_type = get_post_meta($post_id, '_bricks_template_type', true);

    if ($template_type === 'header') {
        return defined('BRICKS_DB_PAGE_HEADER') && is_string(BRICKS_DB_PAGE_HEADER)
            ? BRICKS_DB_PAGE_HEADER
            : '_bricks_page_header_2';
    }

    if ($template_type === 'footer') {
        return defined('BRICKS_DB_PAGE_FOOTER') && is_string(BRICKS_DB_PAGE_FOOTER)
            ? BRICKS_DB_PAGE_FOOTER
            : '_bricks_page_footer_2';
    }

    return defined('BRICKS_DB_PAGE_CONTENT') && is_string(BRICKS_DB_PAGE_CONTENT)
        ? BRICKS_DB_PAGE_CONTENT
        : '_bricks_page_content_2';
}

function bricks_mcp_get_elements_from_post($post_id) {
    $meta_key = bricks_mcp_resolve_elements_meta_key($post_id);
    $raw = get_post_meta($post_id, $meta_key, true);

    if ($raw === '' || $raw === null) {
        $raw = get_post_meta($post_id, '_bricks_page_content', true);
    }

    if (is_array($raw)) {
        return $raw;
    }

    if (is_string($raw) && $raw !== '') {
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }

    return [];
}

function bricks_mcp_normalize_border($border) {
    if (!is_array($border)) {
        return $border;
    }

    if (isset($border['width']) && !is_array($border['width'])) {
        $width = (string) $border['width'];
        $border['width'] = [
            'top' => $width,
            'right' => $width,
            'bottom' => $width,
            'left' => $width,
        ];
    }

    return $border;
}

function bricks_mcp_normalize_element_settings($settings, $element_name = '') {
    if (!is_array($settings)) {
        return $settings;
    }

    if (isset($settings['_backgroundColor']) && is_string($settings['_backgroundColor']) && !isset($settings['_background'])) {
        $settings['_background'] = [ 'color' => $settings['_backgroundColor'] ];
    }

    if (isset($settings['_color']) && is_string($settings['_color'])) {
        if (!isset($settings['_typography']) || !is_array($settings['_typography'])) {
            $settings['_typography'] = [];
        }
        if (!isset($settings['_typography']['color'])) {
            $settings['_typography']['color'] = $settings['_color'];
        }
    }

    if (isset($settings['_border'])) {
        $settings['_border'] = bricks_mcp_normalize_border($settings['_border']);
    }

    return $settings;
}

function bricks_mcp_normalize_elements($elements) {
    if (!is_array($elements)) {
        return [];
    }

    $out = [];
    foreach ($elements as $element) {
        if (!is_array($element)) {
            continue;
        }

        $name = isset($element['name']) ? (string) $element['name'] : '';
        if (isset($element['settings'])) {
            $element['settings'] = bricks_mcp_normalize_element_settings($element['settings'], $name);
        }

        $out[] = $element;
    }

    return $out;
}

function bricks_mcp_can_edit_post($post_id) {
    return current_user_can('edit_post', $post_id);
}

add_action('rest_api_init', function () {
    register_rest_route('bricks-mcp/v1', '/page-elements/(?P<id>\d+)', [
        [
            'methods' => WP_REST_Server::READABLE,
            'callback' => function (WP_REST_Request $request) {
                $post_id = (int) $request['id'];
                $post = get_post($post_id);
                if (!$post) {
                    return new WP_Error('not_found', 'Post not found', ['status' => 404]);
                }

                if (!bricks_mcp_can_edit_post($post_id)) {
                    return new WP_Error('forbidden', 'Insufficient permissions', ['status' => 403]);
                }

                return [
                    'post_id' => $post_id,
                    'post_type' => $post->post_type,
                    'elements' => bricks_mcp_get_elements_from_post($post_id),
                ];
            },
            'permission_callback' => '__return_true',
        ],
        [
            'methods' => WP_REST_Server::EDITABLE,
            'callback' => function (WP_REST_Request $request) {
                $post_id = (int) $request['id'];
                $post = get_post($post_id);
                if (!$post) {
                    return new WP_Error('not_found', 'Post not found', ['status' => 404]);
                }

                if (!bricks_mcp_can_edit_post($post_id)) {
                    return new WP_Error('forbidden', 'Insufficient permissions', ['status' => 403]);
                }

                $body = $request->get_json_params();
                $elements = isset($body['elements']) ? $body['elements'] : [];
                if (!is_array($elements)) {
                    return new WP_Error('invalid_elements', 'elements must be an array', ['status' => 400]);
                }
                $elements = bricks_mcp_normalize_elements($elements);

                $elements_meta_key = bricks_mcp_resolve_elements_meta_key($post_id);
                $editor_mode_key = bricks_mcp_get_editor_mode_key();
                $page_settings_key = bricks_mcp_get_page_settings_key();

                // Store as array post meta (Bricks reads this format natively).
                update_post_meta($post_id, $elements_meta_key, $elements);

                // Compatibility mirror for integrations still checking this key.
                update_post_meta($post_id, '_bricks_page_content', $elements);

                update_post_meta($post_id, $page_settings_key, [
                    'editorMode' => 'bricks',
                    'editor' => 'bricks',
                    'builder' => 'bricks',
                ]);
                update_post_meta($post_id, $editor_mode_key, 'bricks');

                $verified = bricks_mcp_get_elements_from_post($post_id);

                return [
                    'post_id' => $post_id,
                    'post_type' => $post->post_type,
                    'meta_key' => $elements_meta_key,
                    'editor_mode_key' => $editor_mode_key,
                    'elements' => $verified,
                    'element_count' => count($verified),
                    'success' => true,
                ];
            },
            'permission_callback' => '__return_true',
        ],
    ]);
});
