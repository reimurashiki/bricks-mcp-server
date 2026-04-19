#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance } from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

// ===== MULTI-SITE CONFIGURATION =====

interface SiteConfig {
  key: string;
  url: string;
  username: string;
  password: string;
}

function loadSiteConfigs(): Map<string, SiteConfig> {
  const sites = new Map<string, SiteConfig>();
  const siteKeys = (process.env.BRICKS_SITES || '').split(',').map(s => s.trim()).filter(Boolean);

  for (const key of siteKeys) {
    const upperKey = key.toUpperCase();
    const url = process.env[`BRICKS_${upperKey}_URL`];
    const username = process.env[`BRICKS_${upperKey}_USERNAME`];
    const password = process.env[`BRICKS_${upperKey}_PASSWORD`];

    if (url && username && password) {
      sites.set(key.toLowerCase(), { key: key.toLowerCase(), url, username, password });
    } else {
      console.error(`Warning: Incomplete config for site "${key}". Skipping.`);
    }
  }

  return sites;
}

const siteConfigs = loadSiteConfigs();
const defaultSite = siteConfigs.keys().next().value || '';

function getSiteConfig(site?: string): SiteConfig {
  const key = (site || defaultSite).toLowerCase();
  const config = siteConfigs.get(key);
  if (!config) {
    const available = Array.from(siteConfigs.keys()).join(', ');
    throw new Error(`Site "${key}" not configured. Available sites: ${available}`);
  }
  return config;
}

// ===== BRICKS ELEMENT ID GENERATION =====

function generateElementId(): string {
  return Math.random().toString(16).slice(2, 8);
}

// ===== RESPONSE TRIMMING =====

function trimResponse(data: any): any {
  if (Array.isArray(data)) {
    return data.map(trimResponse);
  }
  if (data && typeof data === 'object') {
    const trimmed: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === '_links' || key === 'guid') continue;
      if (key === 'content' && typeof value === 'object' && (value as any)?.rendered !== undefined) continue;
      trimmed[key] = value;
    }
    return trimmed;
  }
  return data;
}

// ===== ELEMENT VALIDATION =====

interface ValidationResult {
  valid: boolean;
  warnings: string[];
}

const BRICKS_ELEMENT_TYPE_NAMES = [
  'section', 'container', 'block', 'div', 'heading', 'text-basic', 'text',
  'image', 'button', 'icon', 'video', 'code', 'list', 'accordion', 'tabs',
  'slider', 'nav-menu', 'form', 'post-content', 'posts', 'map', 'pricing-tables',
];

function validateElement(element: any): ValidationResult {
  const warnings: string[] = [];

  if (!element.name) {
    warnings.push('Element is missing "name" property.');
  } else if (!BRICKS_ELEMENT_TYPE_NAMES.includes(element.name)) {
    warnings.push(`Element type "${element.name}" is not in the known types list. It may be a custom/third-party element.`);
  }

  if (!element.settings || typeof element.settings !== 'object') {
    warnings.push('Element is missing "settings" property or it is not an object.');
  }

  if (element.parent !== undefined && element.parent !== 0 && typeof element.parent !== 'string') {
    warnings.push(`Element parent should be 0 (root) or a string element ID. Got: ${typeof element.parent} (${element.parent}).`);
  }

  if (element.name === 'heading' && element.settings && !element.settings.text) {
    warnings.push('Heading element is missing "text" in settings.');
  }

  if (element.name === 'text-basic' && element.settings && !element.settings.text) {
    warnings.push('Text-basic element is missing "text" in settings.');
  }

  if (element.name === 'button' && element.settings && !element.settings.text) {
    warnings.push('Button element is missing "text" in settings.');
  }

  return { valid: warnings.length === 0, warnings };
}

// ===== BRICKS ELEMENT TYPES REFERENCE =====

const BRICKS_ELEMENT_TYPES = [
  {
    name: 'section',
    description: 'Top-level section wrapper. Every page starts with sections.',
    defaultSettings: {
      tag: 'section',
      _padding: { top: '60px', bottom: '60px' },
    },
    example: {
      id: 'abc123',
      name: 'section',
      parent: 0,
      children: [],
      settings: { tag: 'section', _padding: { top: '60px', bottom: '60px' } },
    },
  },
  {
    name: 'container',
    description: 'Flex container for layout. Replaces the old "div" for flex layouts. Use _direction, _justifyContent, _alignItems.',
    defaultSettings: {
      _direction: 'column',
      _justifyContent: 'center',
      _alignItems: 'center',
      _gap: '20px',
    },
    example: {
      id: 'def456',
      name: 'container',
      parent: 'abc123',
      children: [],
      settings: { _direction: 'column', _justifyContent: 'center', _alignItems: 'center', _gap: '20px' },
    },
  },
  {
    name: 'block',
    description: 'Block-level container (display: block). Good for wrapping content.',
    defaultSettings: {},
    example: {
      id: 'ghi789',
      name: 'block',
      parent: 'abc123',
      children: [],
      settings: {},
    },
  },
  {
    name: 'div',
    description: 'Generic div element. Flexible container.',
    defaultSettings: {},
    example: {
      id: 'jkl012',
      name: 'div',
      parent: 'abc123',
      children: [],
      settings: {},
    },
  },
  {
    name: 'heading',
    description: 'Heading element (h1-h6). Set tag to h1/h2/h3/h4/h5/h6.',
    defaultSettings: {
      tag: 'h2',
      text: 'Heading Text',
    },
    example: {
      id: 'mno345',
      name: 'heading',
      parent: 'def456',
      children: [],
      settings: { tag: 'h2', text: 'Your Heading Here' },
    },
  },
  {
    name: 'text-basic',
    description: 'Basic text / paragraph element. Simple text content.',
    defaultSettings: {
      text: 'Your text here',
      tag: 'p',
    },
    example: {
      id: 'pqr678',
      name: 'text-basic',
      parent: 'def456',
      children: [],
      settings: { text: 'Your paragraph text here.', tag: 'p' },
    },
  },
  {
    name: 'text',
    description: 'Rich text editor element. Supports HTML content.',
    defaultSettings: {
      text: '<p>Rich text content</p>',
    },
    example: {
      id: 'stu901',
      name: 'text',
      parent: 'def456',
      children: [],
      settings: { text: '<p>Rich text with <strong>bold</strong> and <em>italic</em></p>' },
    },
  },
  {
    name: 'image',
    description: 'Image element. Set image URL or WordPress attachment ID.',
    defaultSettings: {
      image: { url: '', id: 0 },
      _objectFit: 'cover',
    },
    example: {
      id: 'vwx234',
      name: 'image',
      parent: 'def456',
      children: [],
      settings: { image: { url: 'https://example.com/image.jpg', id: 0 }, _objectFit: 'cover' },
    },
  },
  {
    name: 'button',
    description: 'Button / CTA element. Set text and link.',
    defaultSettings: {
      text: 'Click Me',
      link: { type: 'external', url: '#' },
      _backgroundColor: '#333333',
      _color: '#ffffff',
      _padding: { top: '12px', right: '24px', bottom: '12px', left: '24px' },
    },
    example: {
      id: 'yza567',
      name: 'button',
      parent: 'def456',
      children: [],
      settings: {
        text: 'Get Started',
        link: { type: 'external', url: '/contact' },
        _backgroundColor: '#2563eb',
        _color: '#ffffff',
      },
    },
  },
  {
    name: 'icon',
    description: 'Icon element. Uses icon libraries (FontAwesome, etc.).',
    defaultSettings: {
      icon: { library: 'fontawesome', icon: 'fas fa-star' },
      _fontSize: '24px',
    },
    example: {
      id: 'bcd890',
      name: 'icon',
      parent: 'def456',
      children: [],
      settings: { icon: { library: 'fontawesome', icon: 'fas fa-star' }, _fontSize: '24px' },
    },
  },
  {
    name: 'video',
    description: 'Video embed element. Supports YouTube, Vimeo, and self-hosted.',
    defaultSettings: {
      videoType: 'youtube',
      videoId: '',
    },
    example: {
      id: 'efg123',
      name: 'video',
      parent: 'def456',
      children: [],
      settings: { videoType: 'youtube', videoId: 'dQw4w9WgXcQ' },
    },
  },
  {
    name: 'code',
    description: 'Custom code element. Inject raw HTML/CSS/JS.',
    defaultSettings: {
      code: '<div>Custom HTML</div>',
    },
    example: {
      id: 'hij456',
      name: 'code',
      parent: 'def456',
      children: [],
      settings: { code: '<div class="custom">Custom HTML here</div>' },
    },
  },
  {
    name: 'list',
    description: 'List element (ul/ol). Set items array.',
    defaultSettings: {
      tag: 'ul',
      items: [{ text: 'Item 1' }, { text: 'Item 2' }, { text: 'Item 3' }],
    },
    example: {
      id: 'klm789',
      name: 'list',
      parent: 'def456',
      children: [],
      settings: { tag: 'ul', items: [{ text: 'Feature 1' }, { text: 'Feature 2' }] },
    },
  },
  {
    name: 'accordion',
    description: 'Accordion / FAQ element.',
    defaultSettings: {
      items: [
        { title: 'Question 1', content: 'Answer 1' },
        { title: 'Question 2', content: 'Answer 2' },
      ],
    },
    example: {
      id: 'nop012',
      name: 'accordion',
      parent: 'def456',
      children: [],
      settings: { items: [{ title: 'FAQ Question', content: 'FAQ Answer' }] },
    },
  },
  {
    name: 'tabs',
    description: 'Tabs component with multiple panels.',
    defaultSettings: {
      items: [
        { title: 'Tab 1', content: 'Tab 1 content' },
        { title: 'Tab 2', content: 'Tab 2 content' },
      ],
    },
    example: {
      id: 'qrs345',
      name: 'tabs',
      parent: 'def456',
      children: [],
      settings: { items: [{ title: 'Tab 1', content: 'Content 1' }] },
    },
  },
  {
    name: 'slider',
    description: 'Slider / carousel element.',
    defaultSettings: {
      items: [],
      autoplay: true,
      speed: 3000,
    },
    example: {
      id: 'tuv678',
      name: 'slider',
      parent: 'def456',
      children: [],
      settings: { autoplay: true, speed: 3000 },
    },
  },
  {
    name: 'nav-menu',
    description: 'Navigation menu element.',
    defaultSettings: {
      menu: 0,
    },
    example: {
      id: 'wxy901',
      name: 'nav-menu',
      parent: 'def456',
      children: [],
      settings: { menu: 0 },
    },
  },
  {
    name: 'form',
    description: 'Contact form element with fields.',
    defaultSettings: {
      fields: [],
      submitButtonText: 'Submit',
    },
    example: {
      id: 'zab234',
      name: 'form',
      parent: 'def456',
      children: [],
      settings: { submitButtonText: 'Send Message' },
    },
  },
  {
    name: 'post-content',
    description: 'Dynamic post content element (for single post/page templates).',
    defaultSettings: {},
    example: {
      id: 'cde567',
      name: 'post-content',
      parent: 'def456',
      children: [],
      settings: {},
    },
  },
  {
    name: 'posts',
    description: 'Post loop / grid. Displays posts with query parameters.',
    defaultSettings: {
      query: { post_type: 'post', posts_per_page: 6 },
    },
    example: {
      id: 'fgh890',
      name: 'posts',
      parent: 'def456',
      children: [],
      settings: { query: { post_type: 'post', posts_per_page: 6 } },
    },
  },
  {
    name: 'map',
    description: 'Google Maps embed element.',
    defaultSettings: {
      address: '',
      zoom: 14,
    },
    example: {
      id: 'ijk123',
      name: 'map',
      parent: 'def456',
      children: [],
      settings: { address: '1600 Amphitheatre Parkway, Mountain View, CA', zoom: 14 },
    },
  },
  {
    name: 'pricing-tables',
    description: 'Pricing tables element.',
    defaultSettings: {
      items: [],
    },
    example: {
      id: 'lmn456',
      name: 'pricing-tables',
      parent: 'def456',
      children: [],
      settings: { items: [] },
    },
  },
];

// ===== SECTION GENERATOR =====

interface BricksElement {
  id: string;
  name: string;
  parent: string | number;
  children?: string[];
  settings: Record<string, any>;
}

function generateSection(sectionType: string, overrides: Record<string, any> = {}): BricksElement[] {
  const sectionId = generateElementId();
  const containerId = generateElementId();

  switch (sectionType) {
    case 'hero': {
      const headingId = generateElementId();
      const textId = generateElementId();
      const buttonId = generateElementId();
      return [
        {
          id: sectionId, name: 'section', parent: 0,
          children: [containerId],
          settings: {
            tag: 'section',
            _padding: { top: '100px', bottom: '100px' },
            _textAlign: 'center',
            ...overrides.section,
          },
        },
        {
          id: containerId, name: 'container', parent: sectionId,
          children: [headingId, textId, buttonId],
          settings: {
            _direction: 'column',
            _justifyContent: 'center',
            _alignItems: 'center',
            _gap: '24px',
            _width: '800px',
            _maxWidth: '100%',
            ...overrides.container,
          },
        },
        {
          id: headingId, name: 'heading', parent: containerId,
          settings: {
            tag: 'h1',
            text: overrides.heading || 'Your Headline Here',
            _fontSize: '48px',
            _fontWeight: '700',
            ...overrides.headingSettings,
          },
        },
        {
          id: textId, name: 'text-basic', parent: containerId,
          settings: {
            tag: 'p',
            text: overrides.text || 'Supporting text that explains your value proposition in a clear and compelling way.',
            _fontSize: '18px',
            _color: '#666666',
            ...overrides.textSettings,
          },
        },
        {
          id: buttonId, name: 'button', parent: containerId,
          settings: {
            text: overrides.buttonText || 'Get Started',
            link: { type: 'external', url: overrides.buttonUrl || '#' },
            _backgroundColor: '#2563eb',
            _color: '#ffffff',
            _padding: { top: '14px', right: '32px', bottom: '14px', left: '32px' },
            _fontSize: '16px',
            _borderRadius: '8px',
            ...overrides.buttonSettings,
          },
        },
      ];
    }

    case 'features': {
      const cols = overrides.columns || 3;
      const featureItems = overrides.features || [
        { title: 'Feature One', description: 'Description of the first feature and its benefits.' },
        { title: 'Feature Two', description: 'Description of the second feature and its benefits.' },
        { title: 'Feature Three', description: 'Description of the third feature and its benefits.' },
      ];
      const headingId = generateElementId();
      const gridId = generateElementId();
      const featureElements: BricksElement[] = [];
      const gridChildren: string[] = [];

      for (const item of featureItems) {
        const cardId = generateElementId();
        const cardHeadingId = generateElementId();
        const cardTextId = generateElementId();
        gridChildren.push(cardId);
        featureElements.push(
          {
            id: cardId, name: 'container', parent: gridId,
            children: [cardHeadingId, cardTextId],
            settings: {
              _direction: 'column', _gap: '12px',
              _padding: { top: '24px', right: '24px', bottom: '24px', left: '24px' },
              _background: { color: '#f9fafb' },
              _borderRadius: '12px',
            },
          },
          {
            id: cardHeadingId, name: 'heading', parent: cardId,
            settings: { tag: 'h3', text: item.title, _fontSize: '20px', _fontWeight: '600' },
          },
          {
            id: cardTextId, name: 'text-basic', parent: cardId,
            settings: { tag: 'p', text: item.description, _color: '#666666' },
          },
        );
      }

      return [
        {
          id: sectionId, name: 'section', parent: 0,
          children: [containerId],
          settings: { tag: 'section', _padding: { top: '80px', bottom: '80px' }, _textAlign: 'center', ...overrides.section },
        },
        {
          id: containerId, name: 'container', parent: sectionId,
          children: [headingId, gridId],
          settings: { _direction: 'column', _alignItems: 'center', _gap: '48px', ...overrides.container },
        },
        {
          id: headingId, name: 'heading', parent: containerId,
          settings: { tag: 'h2', text: overrides.heading || 'Features', _fontSize: '36px', _fontWeight: '700' },
        },
        {
          id: gridId, name: 'container', parent: containerId,
          children: gridChildren,
          settings: {
            _direction: 'row', _flexWrap: 'wrap', _gap: '24px',
            _justifyContent: 'center',
            _width: '100%',
            ...overrides.gridSettings,
          },
        },
        ...featureElements,
      ];
    }

    case 'pricing': {
      const plans = overrides.plans || [
        { name: 'Basic', price: '$9/mo', features: ['Feature A', 'Feature B'], buttonText: 'Start Basic' },
        { name: 'Pro', price: '$29/mo', features: ['Feature A', 'Feature B', 'Feature C'], buttonText: 'Start Pro', highlighted: true },
        { name: 'Enterprise', price: '$99/mo', features: ['All features', 'Priority support'], buttonText: 'Contact Sales' },
      ];
      const headingId = generateElementId();
      const gridId = generateElementId();
      const planElements: BricksElement[] = [];
      const gridChildren: string[] = [];

      for (const plan of plans) {
        const cardId = generateElementId();
        const nameId = generateElementId();
        const priceId = generateElementId();
        const listId = generateElementId();
        const btnId = generateElementId();
        gridChildren.push(cardId);
        planElements.push(
          {
            id: cardId, name: 'container', parent: gridId,
            children: [nameId, priceId, listId, btnId],
            settings: {
              _direction: 'column', _alignItems: 'center', _gap: '16px',
              _padding: { top: '32px', right: '24px', bottom: '32px', left: '24px' },
              _background: { color: plan.highlighted ? '#1e3a5f' : '#ffffff' },
              _borderRadius: '16px',
              _border: { width: '1px', style: 'solid', color: '#e5e7eb' },
              _flex: '1', _minWidth: '280px', _maxWidth: '350px',
            },
          },
          {
            id: nameId, name: 'heading', parent: cardId,
            settings: {
              tag: 'h3', text: plan.name, _fontSize: '20px',
              _color: plan.highlighted ? '#ffffff' : '#111827',
            },
          },
          {
            id: priceId, name: 'heading', parent: cardId,
            settings: {
              tag: 'div', text: plan.price, _fontSize: '36px', _fontWeight: '700',
              _color: plan.highlighted ? '#ffffff' : '#111827',
            },
          },
          {
            id: listId, name: 'list', parent: cardId,
            settings: {
              tag: 'ul',
              items: (plan.features || []).map((f: string) => ({ text: f })),
              _color: plan.highlighted ? '#d1d5db' : '#666666',
            },
          },
          {
            id: btnId, name: 'button', parent: cardId,
            settings: {
              text: plan.buttonText || 'Get Started',
              link: { type: 'external', url: '#' },
              _backgroundColor: plan.highlighted ? '#ffffff' : '#2563eb',
              _color: plan.highlighted ? '#1e3a5f' : '#ffffff',
              _padding: { top: '12px', right: '24px', bottom: '12px', left: '24px' },
              _borderRadius: '8px', _width: '100%', _textAlign: 'center',
            },
          },
        );
      }

      return [
        {
          id: sectionId, name: 'section', parent: 0,
          children: [containerId],
          settings: { tag: 'section', _padding: { top: '80px', bottom: '80px' }, _textAlign: 'center', ...overrides.section },
        },
        {
          id: containerId, name: 'container', parent: sectionId,
          children: [headingId, gridId],
          settings: { _direction: 'column', _alignItems: 'center', _gap: '48px', ...overrides.container },
        },
        {
          id: headingId, name: 'heading', parent: containerId,
          settings: { tag: 'h2', text: overrides.heading || 'Pricing', _fontSize: '36px', _fontWeight: '700' },
        },
        {
          id: gridId, name: 'container', parent: containerId,
          children: gridChildren,
          settings: { _direction: 'row', _flexWrap: 'wrap', _gap: '24px', _justifyContent: 'center', _width: '100%' },
        },
        ...planElements,
      ];
    }

    case 'cta': {
      const headingId = generateElementId();
      const textId = generateElementId();
      const buttonId = generateElementId();
      return [
        {
          id: sectionId, name: 'section', parent: 0,
          children: [containerId],
          settings: {
            tag: 'section',
            _padding: { top: '80px', bottom: '80px' },
            _background: { color: overrides.backgroundColor || '#1e3a5f' },
            _textAlign: 'center',
            ...overrides.section,
          },
        },
        {
          id: containerId, name: 'container', parent: sectionId,
          children: [headingId, textId, buttonId],
          settings: { _direction: 'column', _alignItems: 'center', _gap: '24px', _width: '700px', _maxWidth: '100%', ...overrides.container },
        },
        {
          id: headingId, name: 'heading', parent: containerId,
          settings: { tag: 'h2', text: overrides.heading || 'Ready to get started?', _fontSize: '36px', _fontWeight: '700', _color: '#ffffff' },
        },
        {
          id: textId, name: 'text-basic', parent: containerId,
          settings: { tag: 'p', text: overrides.text || 'Join thousands of satisfied customers today.', _fontSize: '18px', _color: '#d1d5db' },
        },
        {
          id: buttonId, name: 'button', parent: containerId,
          settings: {
            text: overrides.buttonText || 'Start Now',
            link: { type: 'external', url: overrides.buttonUrl || '#' },
            _backgroundColor: '#ffffff', _color: '#1e3a5f',
            _padding: { top: '14px', right: '32px', bottom: '14px', left: '32px' },
            _fontSize: '16px', _borderRadius: '8px', _fontWeight: '600',
            ...overrides.buttonSettings,
          },
        },
      ];
    }

    case 'testimonials': {
      const testimonials = overrides.testimonials || [
        { quote: 'This product changed our workflow completely.', author: 'Jane Doe', role: 'CEO, Company' },
        { quote: 'Best investment we made this year.', author: 'John Smith', role: 'CTO, Startup' },
        { quote: 'Incredible support and features.', author: 'Alice Johnson', role: 'Designer, Agency' },
      ];
      const headingId = generateElementId();
      const gridId = generateElementId();
      const testimonialElements: BricksElement[] = [];
      const gridChildren: string[] = [];

      for (const t of testimonials) {
        const cardId = generateElementId();
        const quoteId = generateElementId();
        const authorId = generateElementId();
        gridChildren.push(cardId);
        testimonialElements.push(
          {
            id: cardId, name: 'container', parent: gridId,
            children: [quoteId, authorId],
            settings: {
              _direction: 'column', _gap: '16px',
              _padding: { top: '24px', right: '24px', bottom: '24px', left: '24px' },
              _background: { color: '#f9fafb' }, _borderRadius: '12px',
              _flex: '1', _minWidth: '280px',
            },
          },
          {
            id: quoteId, name: 'text-basic', parent: cardId,
            settings: { tag: 'p', text: `"${t.quote}"`, _fontStyle: 'italic', _fontSize: '16px', _color: '#374151' },
          },
          {
            id: authorId, name: 'text-basic', parent: cardId,
            settings: { tag: 'p', text: `${t.author} — ${t.role}`, _fontSize: '14px', _fontWeight: '600', _color: '#111827' },
          },
        );
      }

      return [
        {
          id: sectionId, name: 'section', parent: 0,
          children: [containerId],
          settings: { tag: 'section', _padding: { top: '80px', bottom: '80px' }, _textAlign: 'center', ...overrides.section },
        },
        {
          id: containerId, name: 'container', parent: sectionId,
          children: [headingId, gridId],
          settings: { _direction: 'column', _alignItems: 'center', _gap: '48px', ...overrides.container },
        },
        {
          id: headingId, name: 'heading', parent: containerId,
          settings: { tag: 'h2', text: overrides.heading || 'What our customers say', _fontSize: '36px', _fontWeight: '700' },
        },
        {
          id: gridId, name: 'container', parent: containerId,
          children: gridChildren,
          settings: { _direction: 'row', _flexWrap: 'wrap', _gap: '24px', _justifyContent: 'center', _width: '100%' },
        },
        ...testimonialElements,
      ];
    }

    case 'faq': {
      const faqs = overrides.faqs || [
        { title: 'What is this product?', content: 'A detailed answer about the product.' },
        { title: 'How does pricing work?', content: 'A detailed answer about pricing.' },
        { title: 'Can I cancel anytime?', content: 'Yes, you can cancel your subscription at any time.' },
      ];
      const headingId = generateElementId();
      const accordionId = generateElementId();

      return [
        {
          id: sectionId, name: 'section', parent: 0,
          children: [containerId],
          settings: { tag: 'section', _padding: { top: '80px', bottom: '80px' }, _textAlign: 'center', ...overrides.section },
        },
        {
          id: containerId, name: 'container', parent: sectionId,
          children: [headingId, accordionId],
          settings: { _direction: 'column', _alignItems: 'center', _gap: '48px', _width: '800px', _maxWidth: '100%', ...overrides.container },
        },
        {
          id: headingId, name: 'heading', parent: containerId,
          settings: { tag: 'h2', text: overrides.heading || 'Frequently Asked Questions', _fontSize: '36px', _fontWeight: '700' },
        },
        {
          id: accordionId, name: 'accordion', parent: containerId,
          settings: { items: faqs, _width: '100%', _textAlign: 'left' },
        },
      ];
    }

    case 'contact': {
      const headingId = generateElementId();
      const textId = generateElementId();
      const formId = generateElementId();

      return [
        {
          id: sectionId, name: 'section', parent: 0,
          children: [containerId],
          settings: { tag: 'section', _padding: { top: '80px', bottom: '80px' }, _textAlign: 'center', ...overrides.section },
        },
        {
          id: containerId, name: 'container', parent: sectionId,
          children: [headingId, textId, formId],
          settings: { _direction: 'column', _alignItems: 'center', _gap: '32px', _width: '600px', _maxWidth: '100%', ...overrides.container },
        },
        {
          id: headingId, name: 'heading', parent: containerId,
          settings: { tag: 'h2', text: overrides.heading || 'Get in Touch', _fontSize: '36px', _fontWeight: '700' },
        },
        {
          id: textId, name: 'text-basic', parent: containerId,
          settings: { tag: 'p', text: overrides.text || 'Have a question? Fill out the form below and we\'ll get back to you shortly.', _fontSize: '16px', _color: '#666666' },
        },
        {
          id: formId, name: 'form', parent: containerId,
          settings: {
            fields: [
              { type: 'text', label: 'Name', placeholder: 'Your name', required: true },
              { type: 'email', label: 'Email', placeholder: 'your@email.com', required: true },
              { type: 'textarea', label: 'Message', placeholder: 'Your message...', required: true },
            ],
            submitButtonText: overrides.buttonText || 'Send Message',
            _width: '100%',
            ...overrides.formSettings,
          },
        },
      ];
    }

    case 'stats': {
      const stats = overrides.stats || [
        { number: '10K+', label: 'Users' },
        { number: '99.9%', label: 'Uptime' },
        { number: '24/7', label: 'Support' },
        { number: '50+', label: 'Countries' },
      ];
      const headingId = generateElementId();
      const gridId = generateElementId();
      const statElements: BricksElement[] = [];
      const gridChildren: string[] = [];

      for (const stat of stats) {
        const itemId = generateElementId();
        const numberId = generateElementId();
        const labelId = generateElementId();
        gridChildren.push(itemId);
        statElements.push(
          {
            id: itemId, name: 'container', parent: gridId,
            children: [numberId, labelId],
            settings: {
              _direction: 'column', _alignItems: 'center', _gap: '8px',
              _flex: '1', _minWidth: '150px',
            },
          },
          {
            id: numberId, name: 'heading', parent: itemId,
            settings: { tag: 'div', text: stat.number, _fontSize: '42px', _fontWeight: '700', _color: overrides.numberColor || '#2563eb' },
          },
          {
            id: labelId, name: 'text-basic', parent: itemId,
            settings: { tag: 'p', text: stat.label, _fontSize: '16px', _color: '#666666', _fontWeight: '500' },
          },
        );
      }

      return [
        {
          id: sectionId, name: 'section', parent: 0,
          children: [containerId],
          settings: { tag: 'section', _padding: { top: '80px', bottom: '80px' }, _textAlign: 'center', ...overrides.section },
        },
        {
          id: containerId, name: 'container', parent: sectionId,
          children: [headingId, gridId],
          settings: { _direction: 'column', _alignItems: 'center', _gap: '48px', ...overrides.container },
        },
        {
          id: headingId, name: 'heading', parent: containerId,
          settings: { tag: 'h2', text: overrides.heading || 'By the Numbers', _fontSize: '36px', _fontWeight: '700' },
        },
        {
          id: gridId, name: 'container', parent: containerId,
          children: gridChildren,
          settings: { _direction: 'row', _flexWrap: 'wrap', _gap: '32px', _justifyContent: 'center', _width: '100%' },
        },
        ...statElements,
      ];
    }

    case 'team': {
      const members = overrides.members || [
        { name: 'Jane Doe', role: 'CEO & Founder' },
        { name: 'John Smith', role: 'CTO' },
        { name: 'Alice Johnson', role: 'Head of Design' },
      ];
      const headingId = generateElementId();
      const gridId = generateElementId();
      const memberElements: BricksElement[] = [];
      const gridChildren: string[] = [];

      for (const member of members) {
        const cardId = generateElementId();
        const imageId = generateElementId();
        const nameId = generateElementId();
        const roleId = generateElementId();
        gridChildren.push(cardId);
        memberElements.push(
          {
            id: cardId, name: 'container', parent: gridId,
            children: [imageId, nameId, roleId],
            settings: {
              _direction: 'column', _alignItems: 'center', _gap: '12px',
              _flex: '1', _minWidth: '200px', _maxWidth: '280px',
            },
          },
          {
            id: imageId, name: 'image', parent: cardId,
            settings: {
              image: { url: member.image || '', id: 0 },
              _width: '120px', _height: '120px', _borderRadius: '50%', _objectFit: 'cover',
              _background: { color: '#e5e7eb' },
            },
          },
          {
            id: nameId, name: 'heading', parent: cardId,
            settings: { tag: 'h3', text: member.name, _fontSize: '18px', _fontWeight: '600' },
          },
          {
            id: roleId, name: 'text-basic', parent: cardId,
            settings: { tag: 'p', text: member.role, _fontSize: '14px', _color: '#666666' },
          },
        );
      }

      return [
        {
          id: sectionId, name: 'section', parent: 0,
          children: [containerId],
          settings: { tag: 'section', _padding: { top: '80px', bottom: '80px' }, _textAlign: 'center', ...overrides.section },
        },
        {
          id: containerId, name: 'container', parent: sectionId,
          children: [headingId, gridId],
          settings: { _direction: 'column', _alignItems: 'center', _gap: '48px', ...overrides.container },
        },
        {
          id: headingId, name: 'heading', parent: containerId,
          settings: { tag: 'h2', text: overrides.heading || 'Meet the Team', _fontSize: '36px', _fontWeight: '700' },
        },
        {
          id: gridId, name: 'container', parent: containerId,
          children: gridChildren,
          settings: { _direction: 'row', _flexWrap: 'wrap', _gap: '32px', _justifyContent: 'center', _width: '100%' },
        },
        ...memberElements,
      ];
    }

    case 'logos': {
      const logoCount = overrides.logoCount || 5;
      const headingId = generateElementId();
      const rowId = generateElementId();
      const logoElements: BricksElement[] = [];
      const rowChildren: string[] = [];

      for (let i = 0; i < logoCount; i++) {
        const logoId = generateElementId();
        rowChildren.push(logoId);
        const logoItem = overrides.logos?.[i];
        logoElements.push({
          id: logoId, name: 'image', parent: rowId,
          settings: {
            image: { url: logoItem?.url || '', id: 0 },
            _width: '120px', _height: '48px', _objectFit: 'contain',
            _opacity: '0.6',
          },
        });
      }

      return [
        {
          id: sectionId, name: 'section', parent: 0,
          children: [containerId],
          settings: { tag: 'section', _padding: { top: '60px', bottom: '60px' }, _textAlign: 'center', ...overrides.section },
        },
        {
          id: containerId, name: 'container', parent: sectionId,
          children: [headingId, rowId],
          settings: { _direction: 'column', _alignItems: 'center', _gap: '32px', ...overrides.container },
        },
        {
          id: headingId, name: 'text-basic', parent: containerId,
          settings: { tag: 'p', text: overrides.heading || 'Trusted by leading companies', _fontSize: '14px', _fontWeight: '600', _color: '#9ca3af', _textTransform: 'uppercase', _letterSpacing: '1px' },
        },
        {
          id: rowId, name: 'container', parent: containerId,
          children: rowChildren,
          settings: { _direction: 'row', _flexWrap: 'wrap', _gap: '40px', _justifyContent: 'center', _alignItems: 'center', _width: '100%' },
        },
        ...logoElements,
      ];
    }

    case 'newsletter': {
      const headingId = generateElementId();
      const textId = generateElementId();
      const formRowId = generateElementId();
      const inputId = generateElementId();
      const buttonId = generateElementId();

      return [
        {
          id: sectionId, name: 'section', parent: 0,
          children: [containerId],
          settings: {
            tag: 'section',
            _padding: { top: '80px', bottom: '80px' },
            _background: { color: overrides.backgroundColor || '#f3f4f6' },
            _textAlign: 'center',
            ...overrides.section,
          },
        },
        {
          id: containerId, name: 'container', parent: sectionId,
          children: [headingId, textId, formRowId],
          settings: { _direction: 'column', _alignItems: 'center', _gap: '24px', _width: '600px', _maxWidth: '100%', ...overrides.container },
        },
        {
          id: headingId, name: 'heading', parent: containerId,
          settings: { tag: 'h2', text: overrides.heading || 'Stay in the Loop', _fontSize: '36px', _fontWeight: '700' },
        },
        {
          id: textId, name: 'text-basic', parent: containerId,
          settings: { tag: 'p', text: overrides.text || 'Subscribe to our newsletter for the latest updates, tips, and exclusive offers.', _fontSize: '16px', _color: '#666666' },
        },
        {
          id: formRowId, name: 'container', parent: containerId,
          children: [inputId, buttonId],
          settings: { _direction: 'row', _gap: '12px', _width: '100%', _justifyContent: 'center', _alignItems: 'stretch' },
        },
        {
          id: inputId, name: 'form', parent: formRowId,
          settings: {
            fields: [
              { type: 'email', label: '', placeholder: overrides.placeholder || 'Enter your email', required: true },
            ],
            submitButtonText: '',
            _flex: '1',
          },
        },
        {
          id: buttonId, name: 'button', parent: formRowId,
          settings: {
            text: overrides.buttonText || 'Subscribe',
            link: { type: 'external', url: '#' },
            _backgroundColor: '#2563eb', _color: '#ffffff',
            _padding: { top: '12px', right: '24px', bottom: '12px', left: '24px' },
            _borderRadius: '8px', _fontWeight: '600',
            ...overrides.buttonSettings,
          },
        },
      ];
    }

    case 'comparison': {
      const columns = overrides.columns || ['Free', 'Pro', 'Enterprise'];
      const rows = overrides.rows || [
        { feature: 'Basic Features', values: [true, true, true] },
        { feature: 'Advanced Analytics', values: [false, true, true] },
        { feature: 'Priority Support', values: [false, false, true] },
        { feature: 'Custom Integrations', values: [false, true, true] },
        { feature: 'Unlimited Users', values: [false, false, true] },
      ];
      const headingId = generateElementId();
      const tableId = generateElementId();

      const tableChildren: string[] = [];
      const tableElements: BricksElement[] = [];

      // Header row
      const headerRowId = generateElementId();
      tableChildren.push(headerRowId);
      const headerCellChildren: string[] = [];
      const headerCells: BricksElement[] = [];

      // Empty first cell for feature column
      const emptyId = generateElementId();
      headerCellChildren.push(emptyId);
      headerCells.push({
        id: emptyId, name: 'text-basic', parent: headerRowId,
        settings: { tag: 'p', text: '', _flex: '1', _minWidth: '150px' },
      });

      for (const col of columns) {
        const cellId = generateElementId();
        headerCellChildren.push(cellId);
        headerCells.push({
          id: cellId, name: 'heading', parent: headerRowId,
          settings: { tag: 'h4', text: col, _fontSize: '16px', _fontWeight: '700', _flex: '1', _textAlign: 'center' },
        });
      }

      tableElements.push(
        {
          id: headerRowId, name: 'container', parent: tableId,
          children: headerCellChildren,
          settings: {
            _direction: 'row', _gap: '0px', _width: '100%',
            _padding: { top: '16px', bottom: '16px' },
            _borderBottom: { width: '2px', style: 'solid', color: '#e5e7eb' },
          },
        },
        ...headerCells,
      );

      // Data rows
      for (const row of rows) {
        const rowId = generateElementId();
        tableChildren.push(rowId);
        const cellChildren: string[] = [];
        const cells: BricksElement[] = [];

        const featureCellId = generateElementId();
        cellChildren.push(featureCellId);
        cells.push({
          id: featureCellId, name: 'text-basic', parent: rowId,
          settings: { tag: 'p', text: row.feature, _flex: '1', _minWidth: '150px', _fontWeight: '500' },
        });

        for (let i = 0; i < columns.length; i++) {
          const valCellId = generateElementId();
          cellChildren.push(valCellId);
          const val = row.values?.[i];
          cells.push({
            id: valCellId, name: 'text-basic', parent: rowId,
            settings: {
              tag: 'p',
              text: val === true ? '&#10003;' : val === false ? '&#8212;' : String(val),
              _flex: '1', _textAlign: 'center', _fontSize: '16px',
              _color: val === true ? '#16a34a' : '#9ca3af',
            },
          });
        }

        tableElements.push(
          {
            id: rowId, name: 'container', parent: tableId,
            children: cellChildren,
            settings: {
              _direction: 'row', _gap: '0px', _width: '100%',
              _padding: { top: '12px', bottom: '12px' },
              _borderBottom: { width: '1px', style: 'solid', color: '#f3f4f6' },
            },
          },
          ...cells,
        );
      }

      return [
        {
          id: sectionId, name: 'section', parent: 0,
          children: [containerId],
          settings: { tag: 'section', _padding: { top: '80px', bottom: '80px' }, _textAlign: 'center', ...overrides.section },
        },
        {
          id: containerId, name: 'container', parent: sectionId,
          children: [headingId, tableId],
          settings: { _direction: 'column', _alignItems: 'center', _gap: '48px', _width: '900px', _maxWidth: '100%', ...overrides.container },
        },
        {
          id: headingId, name: 'heading', parent: containerId,
          settings: { tag: 'h2', text: overrides.heading || 'Compare Plans', _fontSize: '36px', _fontWeight: '700' },
        },
        {
          id: tableId, name: 'container', parent: containerId,
          children: tableChildren,
          settings: { _direction: 'column', _width: '100%', _gap: '0px' },
        },
        ...tableElements,
      ];
    }

    case 'steps': {
      const steps = overrides.steps || [
        { title: 'Sign Up', description: 'Create your free account in seconds.' },
        { title: 'Configure', description: 'Set up your workspace and preferences.' },
        { title: 'Launch', description: 'Start using the platform and see results.' },
      ];
      const headingId = generateElementId();
      const gridId = generateElementId();
      const stepElements: BricksElement[] = [];
      const gridChildren: string[] = [];

      steps.forEach((step: any, index: number) => {
        const stepId = generateElementId();
        const numberId = generateElementId();
        const titleId = generateElementId();
        const descId = generateElementId();
        gridChildren.push(stepId);
        stepElements.push(
          {
            id: stepId, name: 'container', parent: gridId,
            children: [numberId, titleId, descId],
            settings: {
              _direction: 'column', _alignItems: 'center', _gap: '12px',
              _flex: '1', _minWidth: '200px',
            },
          },
          {
            id: numberId, name: 'heading', parent: stepId,
            settings: {
              tag: 'div', text: String(index + 1),
              _fontSize: '24px', _fontWeight: '700',
              _width: '48px', _height: '48px',
              _background: { color: overrides.stepColor || '#2563eb' },
              _color: '#ffffff', _borderRadius: '50%',
              _display: 'flex', _justifyContent: 'center', _alignItems: 'center',
            },
          },
          {
            id: titleId, name: 'heading', parent: stepId,
            settings: { tag: 'h3', text: step.title, _fontSize: '20px', _fontWeight: '600' },
          },
          {
            id: descId, name: 'text-basic', parent: stepId,
            settings: { tag: 'p', text: step.description, _fontSize: '14px', _color: '#666666', _textAlign: 'center' },
          },
        );
      });

      return [
        {
          id: sectionId, name: 'section', parent: 0,
          children: [containerId],
          settings: { tag: 'section', _padding: { top: '80px', bottom: '80px' }, _textAlign: 'center', ...overrides.section },
        },
        {
          id: containerId, name: 'container', parent: sectionId,
          children: [headingId, gridId],
          settings: { _direction: 'column', _alignItems: 'center', _gap: '48px', ...overrides.container },
        },
        {
          id: headingId, name: 'heading', parent: containerId,
          settings: { tag: 'h2', text: overrides.heading || 'How It Works', _fontSize: '36px', _fontWeight: '700' },
        },
        {
          id: gridId, name: 'container', parent: containerId,
          children: gridChildren,
          settings: { _direction: 'row', _flexWrap: 'wrap', _gap: '32px', _justifyContent: 'center', _width: '100%' },
        },
        ...stepElements,
      ];
    }

    case 'footer': {
      const col1Id = generateElementId();
      const col2Id = generateElementId();
      const col3Id = generateElementId();
      const col4Id = generateElementId();

      const logoId = generateElementId();
      const aboutId = generateElementId();

      const linksHeadingId = generateElementId();
      const linksListId = generateElementId();

      const contactHeadingId = generateElementId();
      const contactEmailId = generateElementId();
      const contactPhoneId = generateElementId();

      const socialHeadingId = generateElementId();
      const socialTextId = generateElementId();

      const links = overrides.links || [
        { text: 'Home', url: '/' },
        { text: 'About', url: '/about' },
        { text: 'Services', url: '/services' },
        { text: 'Blog', url: '/blog' },
        { text: 'Contact', url: '/contact' },
      ];

      return [
        {
          id: sectionId, name: 'section', parent: 0,
          children: [containerId],
          settings: {
            tag: 'footer',
            _padding: { top: '60px', bottom: '40px' },
            _background: { color: overrides.backgroundColor || '#111827' },
            ...overrides.section,
          },
        },
        {
          id: containerId, name: 'container', parent: sectionId,
          children: [col1Id, col2Id, col3Id, col4Id],
          settings: { _direction: 'row', _flexWrap: 'wrap', _gap: '40px', _justifyContent: 'space-between', _width: '100%', ...overrides.container },
        },
        // Column 1: Logo + About
        {
          id: col1Id, name: 'container', parent: containerId,
          children: [logoId, aboutId],
          settings: { _direction: 'column', _gap: '16px', _flex: '1', _minWidth: '200px' },
        },
        {
          id: logoId, name: 'heading', parent: col1Id,
          settings: { tag: 'div', text: overrides.siteName || 'Your Brand', _fontSize: '20px', _fontWeight: '700', _color: '#ffffff' },
        },
        {
          id: aboutId, name: 'text-basic', parent: col1Id,
          settings: { tag: 'p', text: overrides.aboutText || 'A brief description about your company and what you do.', _fontSize: '14px', _color: '#9ca3af' },
        },
        // Column 2: Links
        {
          id: col2Id, name: 'container', parent: containerId,
          children: [linksHeadingId, linksListId],
          settings: { _direction: 'column', _gap: '16px', _flex: '1', _minWidth: '150px' },
        },
        {
          id: linksHeadingId, name: 'heading', parent: col2Id,
          settings: { tag: 'h4', text: 'Quick Links', _fontSize: '16px', _fontWeight: '600', _color: '#ffffff' },
        },
        {
          id: linksListId, name: 'list', parent: col2Id,
          settings: {
            tag: 'ul',
            items: links.map((l: any) => ({ text: l.text })),
            _color: '#9ca3af', _fontSize: '14px', _listStyleType: 'none', _padding: { left: '0px' },
          },
        },
        // Column 3: Contact
        {
          id: col3Id, name: 'container', parent: containerId,
          children: [contactHeadingId, contactEmailId, contactPhoneId],
          settings: { _direction: 'column', _gap: '12px', _flex: '1', _minWidth: '150px' },
        },
        {
          id: contactHeadingId, name: 'heading', parent: col3Id,
          settings: { tag: 'h4', text: 'Contact', _fontSize: '16px', _fontWeight: '600', _color: '#ffffff' },
        },
        {
          id: contactEmailId, name: 'text-basic', parent: col3Id,
          settings: { tag: 'p', text: overrides.email || 'hello@example.com', _fontSize: '14px', _color: '#9ca3af' },
        },
        {
          id: contactPhoneId, name: 'text-basic', parent: col3Id,
          settings: { tag: 'p', text: overrides.phone || '+1 (555) 000-0000', _fontSize: '14px', _color: '#9ca3af' },
        },
        // Column 4: Social
        {
          id: col4Id, name: 'container', parent: containerId,
          children: [socialHeadingId, socialTextId],
          settings: { _direction: 'column', _gap: '12px', _flex: '1', _minWidth: '150px' },
        },
        {
          id: socialHeadingId, name: 'heading', parent: col4Id,
          settings: { tag: 'h4', text: 'Follow Us', _fontSize: '16px', _fontWeight: '600', _color: '#ffffff' },
        },
        {
          id: socialTextId, name: 'text-basic', parent: col4Id,
          settings: { tag: 'p', text: overrides.socialText || 'Twitter / LinkedIn / GitHub', _fontSize: '14px', _color: '#9ca3af' },
        },
      ];
    }

    default:
      throw new Error(`Unknown section type: "${sectionType}". Available: hero, features, pricing, cta, testimonials, faq, contact, stats, team, logos, newsletter, comparison, steps, footer`);
  }
}

// ===== CPT ENDPOINT HELPER =====

function normalizePostType(postType: string = 'pages'): string {
  const normalized = String(postType || 'pages').trim().toLowerCase();

  if (normalized === 'page' || normalized === 'pages') {
    return 'pages';
  }

  if (normalized === 'post' || normalized === 'posts') {
    return 'posts';
  }

  return normalized;
}

const BRICKS_CONTENT_META_KEYS = ['_bricks_page_content_2', '_bricks_page_content'];
const BRICKS_CONTENT_MARKER_PREFIX = '[[BRICKS_MCP_CONTENT:';
const BRICKS_CONTENT_MARKER_SUFFIX = ']]';
const BRICKS_CONTENT_MARKER_PREFIX_LEGACY = '<!-- BRICKS_MCP_CONTENT:';
const BRICKS_CONTENT_MARKER_SUFFIX_LEGACY = ' -->';

const BRICKS_VISUAL_SETTINGS_WHITELIST = new Set([
  '_background',
  '_backgroundColor',
  '_color',
  '_typography',
  '_border',
  '_borderRadius',
  '_boxShadow',
  '_opacity',
]);

const BRICKS_BUTTON_VISUAL_WHITELIST = new Set([
  '_backgroundColor',
  '_color',
  '_border',
  '_borderRadius',
  '_boxShadow',
  '_opacity',
]);

function buildBricksPageSettingsMeta(): string {
  return JSON.stringify({
    editorMode: 'bricks',
    editor: 'bricks',
    builder: 'bricks',
  });
}

function removeBricksContentMarkers(content: string): string {
  if (!content || typeof content !== 'string') {
    return '';
  }

  let cleaned = content;

  const variants: Array<{ start: string; end: string }> = [
    { start: BRICKS_CONTENT_MARKER_PREFIX, end: BRICKS_CONTENT_MARKER_SUFFIX },
    { start: BRICKS_CONTENT_MARKER_PREFIX_LEGACY, end: BRICKS_CONTENT_MARKER_SUFFIX_LEGACY },
  ];

  for (const variant of variants) {
    let startIndex = cleaned.indexOf(variant.start);
    while (startIndex !== -1) {
      const encodedStart = startIndex + variant.start.length;
      const endIndex = cleaned.indexOf(variant.end, encodedStart);
      if (endIndex === -1) {
        break;
      }

      cleaned = `${cleaned.slice(0, startIndex)}${cleaned.slice(endIndex + variant.end.length)}`;
      startIndex = cleaned.indexOf(variant.start);
    }
  }

  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

function upsertBricksContentMarker(content: string, elements: any[]): string {
  // Disabled intentionally: fallback marker write is no longer used for persistence.
  return removeBricksContentMarkers(content);
}

function getPostTypeEndpoint(postType: string, postId?: number): string {
  const normalizedPostType = normalizePostType(postType);
  const base = normalizedPostType === 'pages' ? '/wp/v2/pages' : normalizedPostType === 'posts' ? '/wp/v2/posts' : `/wp/v2/${normalizedPostType}`;
  return postId !== undefined ? `${base}/${postId}` : base;
}

// ===== BRICKS API CLIENT =====

class BricksClient {
  private clients: Map<string, AxiosInstance> = new Map();

  private isObject(value: any): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  private normalizeBorderValue(border: any): any {
    if (!this.isObject(border)) {
      return border;
    }

    const out: any = { ...border };
    if (typeof out.width === 'string' || typeof out.width === 'number') {
      const width = String(out.width);
      out.width = { top: width, right: width, bottom: width, left: width };
    }

    return out;
  }

  private normalizeSettingsForPersistence(settings: any, elementName: string): any {
    if (!this.isObject(settings)) {
      return settings;
    }

    const normalized: Record<string, any> = JSON.parse(JSON.stringify(settings));

    // Ensure key visual styles are preserved and available in expected shapes.
    if (typeof normalized._backgroundColor === 'string' && !this.isObject(normalized._background)) {
      normalized._background = { color: normalized._backgroundColor };
    }

    if (typeof normalized._color === 'string') {
      if (!this.isObject(normalized._typography)) {
        normalized._typography = {};
      }
      if (normalized._typography.color === undefined) {
        normalized._typography.color = normalized._color;
      }
    }

    if (normalized._border !== undefined) {
      normalized._border = this.normalizeBorderValue(normalized._border);
    }

    // No stripping: explicitly preserve visual keys even if upstream normalizer changes.
    for (const key of BRICKS_VISUAL_SETTINGS_WHITELIST) {
      if (settings[key] !== undefined && normalized[key] === undefined) {
        normalized[key] = JSON.parse(JSON.stringify(settings[key]));
      }
    }

    if (elementName === 'button') {
      for (const key of BRICKS_BUTTON_VISUAL_WHITELIST) {
        if (settings[key] !== undefined && normalized[key] === undefined) {
          normalized[key] = JSON.parse(JSON.stringify(settings[key]));
        }
      }
    }

    return normalized;
  }

  private normalizeElementsForPersistence(elements: any[]): any[] {
    return (elements || []).map((element: any) => {
      if (!this.isObject(element)) {
        return element;
      }

      const normalized = JSON.parse(JSON.stringify(element));
      normalized.settings = this.normalizeSettingsForPersistence(normalized.settings, String(normalized.name || ''));
      return normalized;
    });
  }

  private containsExpectedValue(expected: any, actual: any): boolean {
    if (Array.isArray(expected)) {
      if (!Array.isArray(actual) || actual.length !== expected.length) {
        return false;
      }

      return expected.every((item, index) => this.containsExpectedValue(item, actual[index]));
    }

    if (this.isObject(expected)) {
      if (!this.isObject(actual)) {
        return false;
      }

      for (const [key, value] of Object.entries(expected)) {
        if (!(key in actual)) {
          return false;
        }

        if (!this.containsExpectedValue(value, (actual as any)[key])) {
          return false;
        }
      }

      return true;
    }

    return expected === actual;
  }

  private persistedElementsContainExpected(expectedElements: any[], persistedElements: any[]): boolean {
    if (!Array.isArray(expectedElements) || !Array.isArray(persistedElements)) {
      return false;
    }

    if (expectedElements.length !== persistedElements.length) {
      return false;
    }

    const persistedById = new Map<string, any>();
    for (const element of persistedElements) {
      if (this.isObject(element) && element.id !== undefined) {
        persistedById.set(String(element.id), element);
      }
    }

    for (let index = 0; index < expectedElements.length; index += 1) {
      const expectedElement = expectedElements[index];
      if (!this.isObject(expectedElement)) {
        continue;
      }

      const expectedId = expectedElement.id !== undefined ? String(expectedElement.id) : '';
      const candidate = expectedId ? persistedById.get(expectedId) : persistedElements[index];

      if (!this.isObject(candidate)) {
        return false;
      }

      const expectedName = String(expectedElement.name || '');
      if (String(candidate.name || '') !== expectedName) {
        return false;
      }

      const expectedSettings = this.normalizeSettingsForPersistence(expectedElement.settings, expectedName);
      const persistedSettings = this.normalizeSettingsForPersistence(candidate.settings, String(candidate.name || ''));

      if (!this.containsExpectedValue(expectedSettings, persistedSettings)) {
        return false;
      }
    }

    return true;
  }

  private extractBricksElements(postData: any): any[] {
    const meta = postData?.meta || {};

    const bricksContent = BRICKS_CONTENT_META_KEYS
      .map((key) => meta[key] ?? postData?.[key] ?? meta[key.replace(/^_/, '')] ?? postData?.[key.replace(/^_/, '')])
      .find((value) => value !== undefined && value !== null && value !== '');

    if (Array.isArray(bricksContent)) {
      return bricksContent;
    }

    if (typeof bricksContent === 'string') {
      try {
        const parsed = JSON.parse(bricksContent);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        throw new Error('Invalid Bricks content format in "_bricks_page_content_2": expected valid JSON array.');
      }
    }

    return [];
  }

  private async cleanupVisibleBricksMarker(postId: number, postType: string, site?: string): Promise<void> {
    const api = this.getApiClient(site);
    const endpoint = getPostTypeEndpoint(postType, postId);
    const current = await api.get(endpoint, { params: { context: 'edit' } });
    const currentContent = current.data?.content?.raw || current.data?.content?.rendered || '';
    const cleanedContent = removeBricksContentMarkers(currentContent);

    if (cleanedContent !== currentContent) {
      await api.post(endpoint, { content: cleanedContent });
    }
  }

  private async getPageElementsViaMetaBridge(postId: number, postType: string, site?: string): Promise<any[] | null> {
    const api = this.getApiClient(site);

    try {
      const response = await api.get(`/bricks-mcp/v1/page-elements/${postId}`, {
        params: { post_type: postType },
      });
      const bridgeElements = response.data?.elements;
      return Array.isArray(bridgeElements) ? bridgeElements : [];
    } catch {
      return null;
    }
  }

  private async setPageElementsViaMetaBridge(postId: number, elements: any[], postType: string, site?: string): Promise<boolean> {
    const api = this.getApiClient(site);

    try {
      await api.post(`/bricks-mcp/v1/page-elements/${postId}`, {
        post_type: postType,
        elements,
      });
      return true;
    } catch {
      return false;
    }
  }

  private getApiClient(site?: string): AxiosInstance {
    const config = getSiteConfig(site);
    const key = config.key;

    if (!this.clients.has(key)) {
      const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');
      const client = axios.create({
        baseURL: `${config.url}/wp-json`,
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        timeout: 30000,
      });

      client.interceptors.response.use(
        response => response,
        error => {
          const message = error.response?.data?.message || error.response?.data?.code || error.message;
          const status = error.response?.status || 'unknown';
          throw new Error(`Bricks API Error (${status}): ${message}`);
        }
      );

      this.clients.set(key, client);
    }

    return this.clients.get(key)!;
  }

  // ===== PAGE/POST BRICKS CONTENT =====

  async getPageElements(postId: number, postType: string = 'pages', site?: string): Promise<any> {
    const api = this.getApiClient(site);
    const normalizedPostType = normalizePostType(postType);
    const endpoint = getPostTypeEndpoint(normalizedPostType, postId);
    const response = await api.get(endpoint, { params: { context: 'edit' } });
    const bridgeElements = await this.getPageElementsViaMetaBridge(postId, normalizedPostType, site);
    const elements = Array.isArray(bridgeElements)
      ? bridgeElements
      : this.extractBricksElements(response.data);

    return {
      post_id: response.data.id,
      post_type: normalizedPostType,
      title: response.data.title?.rendered || response.data.title?.raw || '',
      status: response.data.status,
      elements,
      element_count: elements.length,
    };
  }

  async setPageElements(postId: number, elements: any[], postType: string = 'pages', site?: string): Promise<any> {
    const api = this.getApiClient(site);
    const normalizedPostType = normalizePostType(postType);
    const endpoint = getPostTypeEndpoint(normalizedPostType, postId);
    const pageSettingsMeta = buildBricksPageSettingsMeta();
    const normalizedElements = this.normalizeElementsForPersistence(elements);
    let isPersisted = false;
    let storage: 'meta' | 'meta_bridge' = 'meta';

    const bridgeWriteOk = await this.setPageElementsViaMetaBridge(postId, normalizedElements, normalizedPostType, site);
    if (bridgeWriteOk) {
      const bridgePersisted = await this.getPageElementsViaMetaBridge(postId, normalizedPostType, site);
      if (Array.isArray(bridgePersisted) && this.persistedElementsContainExpected(normalizedElements, bridgePersisted)) {
        isPersisted = true;
        storage = 'meta_bridge';
      }
    }

    if (!isPersisted) {
      await api.post(endpoint, {
        meta: {
          _bricks_page_content_2: JSON.stringify(normalizedElements),
          _bricks_page_content: JSON.stringify(normalizedElements),
          _bricks_page_settings: pageSettingsMeta,
          _bricks_editor_mode: 'bricks',
        },
      });

      const wpPersistedResponse = await api.get(endpoint, { params: { context: 'edit' } });
      const wpPersistedElements = this.extractBricksElements(wpPersistedResponse.data);
      isPersisted = this.persistedElementsContainExpected(normalizedElements, wpPersistedElements);
      storage = 'meta';
    }

    if (!isPersisted) {
      throw new Error(
        `Bricks meta persistence mismatch on post ${postId}: expected visual/layout settings were not fully persisted in Bricks meta (_bricks_page_content_2). This usually indicates REST meta sanitization. Ensure bridge endpoint /bricks-mcp/v1/page-elements is reachable and writable.`
      );
    }

    await this.cleanupVisibleBricksMarker(postId, normalizedPostType, site);

    const persisted = await this.getPageElements(postId, normalizedPostType, site);

    return {
      post_id: persisted.post_id,
      post_type: normalizedPostType,
      title: persisted.title,
      status: persisted.status,
      element_count: normalizedElements.length,
      persisted: isPersisted,
      storage,
      success: true,
    };
  }

  async addElement(postId: number, element: any, postType: string = 'pages', site?: string): Promise<any> {
    const current = await this.getPageElements(postId, postType, site);
    const elements = current.elements || [];

    if (!element.id) {
      element.id = generateElementId();
    }

    const validation = validateElement(element);

    // If element has a parent, add it to parent's children array
    if (element.parent && element.parent !== 0) {
      const parentEl = elements.find((el: any) => el.id === element.parent);
      if (parentEl) {
        if (!parentEl.children) parentEl.children = [];
        parentEl.children.push(element.id);
      }
    }

    elements.push(element);
    await this.setPageElements(postId, elements, postType, site);

    const result: any = {
      post_id: postId,
      added_element_id: element.id,
      total_elements: elements.length,
      success: true,
    };

    if (!validation.valid) {
      result.warnings = validation.warnings;
    }

    return result;
  }

  async removeElement(postId: number, elementId: string, postType: string = 'pages', site?: string): Promise<any> {
    const current = await this.getPageElements(postId, postType, site);
    let elements = current.elements || [];

    // Collect IDs to remove (element + all descendants)
    const idsToRemove = new Set<string>();
    const collectDescendants = (id: string) => {
      idsToRemove.add(id);
      for (const el of elements) {
        if (el.parent === id) {
          collectDescendants(el.id);
        }
      }
    };
    collectDescendants(elementId);

    if (idsToRemove.size === 0 || !elements.some((el: any) => el.id === elementId)) {
      throw new Error(`Element "${elementId}" not found on post ${postId}`);
    }

    // Remove from parent's children array
    for (const el of elements) {
      if (el.children && Array.isArray(el.children)) {
        el.children = el.children.filter((cid: string) => !idsToRemove.has(cid));
      }
    }

    const originalCount = elements.length;
    elements = elements.filter((el: any) => !idsToRemove.has(el.id));
    await this.setPageElements(postId, elements, postType, site);

    return {
      post_id: postId,
      removed_element_id: elementId,
      removed_count: originalCount - elements.length,
      total_elements: elements.length,
      success: true,
    };
  }

  async updateElement(postId: number, elementId: string, settings: any, postType: string = 'pages', site?: string): Promise<any> {
    const current = await this.getPageElements(postId, postType, site);
    const elements = current.elements || [];

    const element = elements.find((el: any) => el.id === elementId);
    if (!element) {
      throw new Error(`Element "${elementId}" not found on post ${postId}`);
    }

    element.settings = { ...element.settings, ...settings };
    await this.setPageElements(postId, elements, postType, site);

    return {
      post_id: postId,
      updated_element_id: elementId,
      element: element,
      success: true,
    };
  }

  // ===== FIND ELEMENT =====

  async findElement(postId: number, postType: string = 'pages', filters: { element_type?: string; text_search?: string; css_class?: string }, site?: string): Promise<any> {
    const current = await this.getPageElements(postId, postType, site);
    const elements = current.elements || [];

    const elementMap = new Map<string, any>();
    for (const el of elements) {
      elementMap.set(el.id, el);
    }

    const getParentChain = (elId: string | number): string[] => {
      const chain: string[] = [];
      let currentId = elId;
      while (currentId && currentId !== 0) {
        const parent = elementMap.get(String(currentId));
        if (!parent) break;
        chain.unshift(`${parent.name}(${parent.id})`);
        currentId = parent.parent;
      }
      return chain;
    };

    let matches = elements;

    if (filters.element_type) {
      matches = matches.filter((el: any) => el.name === filters.element_type);
    }

    if (filters.text_search) {
      const search = filters.text_search.toLowerCase();
      matches = matches.filter((el: any) => {
        const settings = el.settings || {};
        const text = String(settings.text || '').toLowerCase();
        const items = JSON.stringify(settings.items || []).toLowerCase();
        return text.includes(search) || items.includes(search);
      });
    }

    if (filters.css_class) {
      const searchClass = filters.css_class.toLowerCase();
      matches = matches.filter((el: any) => {
        const cssClass = String(el.settings?._cssClasses || '').toLowerCase();
        const globalClasses = JSON.stringify(el.settings?._cssGlobalClasses || []).toLowerCase();
        return cssClass.includes(searchClass) || globalClasses.includes(searchClass);
      });
    }

    const results = matches.map((el: any) => ({
      id: el.id,
      name: el.name,
      parent: el.parent,
      parent_chain: getParentChain(el.parent),
      settings_summary: {
        text: el.settings?.text,
        tag: el.settings?.tag,
        _cssClasses: el.settings?._cssClasses,
        _cssGlobalClasses: el.settings?._cssGlobalClasses,
      },
      children_count: el.children?.length || 0,
    }));

    return {
      post_id: postId,
      matches: results,
      match_count: results.length,
      total_elements: elements.length,
    };
  }

  // ===== SNAPSHOTS =====

  async snapshotPage(postId: number, postType: string = 'pages', label?: string, site?: string): Promise<any> {
    const api = this.getApiClient(site);
    const normalizedPostType = normalizePostType(postType);
    const current = await this.getPageElements(postId, normalizedPostType, site);
    const timestamp = Date.now();
    const snapshotKey = `_bricks_snapshot_${timestamp}`;

    const endpoint = getPostTypeEndpoint(normalizedPostType, postId);
    await api.post(endpoint, {
      meta: {
        [snapshotKey]: JSON.stringify({
          elements: current.elements,
          label: label || '',
          timestamp,
          element_count: current.elements.length,
        }),
      },
    });

    return {
      post_id: postId,
      post_type: normalizedPostType,
      snapshot_key: snapshotKey,
      element_count: current.elements.length,
      timestamp,
      label: label || '',
      success: true,
    };
  }

  async restoreSnapshot(postId: number, postType: string = 'pages', snapshotKey: string, site?: string): Promise<any> {
    const api = this.getApiClient(site);
    const normalizedPostType = normalizePostType(postType);
    const endpoint = getPostTypeEndpoint(normalizedPostType, postId);
    const response = await api.get(endpoint, { params: { context: 'edit' } });
    const meta = response.data.meta || {};
    const snapshotRaw = meta[snapshotKey];

    if (!snapshotRaw) {
      throw new Error(`Snapshot "${snapshotKey}" not found on post ${postId}`);
    }

    const snapshot = typeof snapshotRaw === 'string' ? JSON.parse(snapshotRaw) : snapshotRaw;
    const elements = snapshot.elements || [];

    await this.setPageElements(postId, elements, normalizedPostType, site);

    return {
      post_id: postId,
      post_type: normalizedPostType,
      snapshot_key: snapshotKey,
      restored_element_count: elements.length,
      success: true,
    };
  }

  async listSnapshots(postId: number, postType: string = 'pages', site?: string): Promise<any> {
    const api = this.getApiClient(site);
    const normalizedPostType = normalizePostType(postType);
    const endpoint = getPostTypeEndpoint(normalizedPostType, postId);
    const response = await api.get(endpoint, { params: { context: 'edit' } });
    const meta = response.data.meta || {};

    const snapshots: any[] = [];
    for (const [key, value] of Object.entries(meta)) {
      if (key.startsWith('_bricks_snapshot_')) {
        try {
          const data = typeof value === 'string' ? JSON.parse(value) : value;
          snapshots.push({
            snapshot_key: key,
            label: data.label || '',
            timestamp: data.timestamp,
            element_count: data.element_count || (data.elements ? data.elements.length : 0),
          });
        } catch { /* skip invalid snapshots */ }
      }
    }

    snapshots.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    return {
      post_id: postId,
      post_type: normalizedPostType,
      snapshots,
      snapshot_count: snapshots.length,
    };
  }

  async deleteSnapshot(postId: number, snapshotKey: string, postType: string = 'pages', site?: string): Promise<any> {
    const api = this.getApiClient(site);
    const normalizedPostType = normalizePostType(postType);
    const endpoint = `${getPostTypeEndpoint(normalizedPostType)}/${postId}`;
    const response = await api.get(endpoint, { params: { context: 'edit' } });
    const meta = response.data.meta || {};

    if (!meta[snapshotKey]) {
      throw new Error(`Snapshot "${snapshotKey}" not found on post ${postId}`);
    }

    // Delete by setting meta to empty string (WP REST API convention)
    await api.post(endpoint, {
      meta: { [snapshotKey]: '' },
    });

    return {
      post_id: postId,
      post_type: normalizedPostType,
      deleted_snapshot: snapshotKey,
      success: true,
    };
  }

  // ===== BULK UPDATE =====

  async bulkUpdateElements(postId: number, postType: string = 'pages', updates: { element_id: string; settings: any }[], site?: string): Promise<any> {
    const current = await this.getPageElements(postId, postType, site);
    const elements = current.elements || [];

    let updatedCount = 0;
    let failedCount = 0;
    const details: any[] = [];
    const allWarnings: string[] = [];

    for (const update of updates) {
      const element = elements.find((el: any) => el.id === update.element_id);
      if (!element) {
        failedCount++;
        details.push({ element_id: update.element_id, success: false, error: 'Element not found' });
        continue;
      }

      element.settings = { ...element.settings, ...update.settings };

      const validation = validateElement(element);
      if (!validation.valid) {
        allWarnings.push(...validation.warnings.map(w => `[${update.element_id}] ${w}`));
      }

      updatedCount++;
      details.push({ element_id: update.element_id, success: true });
    }

    await this.setPageElements(postId, elements, postType, site);

    const result: any = {
      post_id: postId,
      updated_count: updatedCount,
      failed_count: failedCount,
      details,
      success: true,
    };

    if (allWarnings.length > 0) {
      result.warnings = allWarnings;
    }

    return result;
  }

  // ===== MOVE ELEMENT =====

  async moveElement(postId: number, postType: string = 'pages', elementId: string, newParentId: string | number, position?: number, site?: string): Promise<any> {
    const current = await this.getPageElements(postId, postType, site);
    const elements = current.elements || [];

    const element = elements.find((el: any) => el.id === elementId);
    if (!element) {
      throw new Error(`Element "${elementId}" not found on post ${postId}`);
    }

    const oldParentId = element.parent;

    // Remove from old parent's children
    if (oldParentId && oldParentId !== 0) {
      const oldParent = elements.find((el: any) => el.id === oldParentId);
      if (oldParent && oldParent.children) {
        oldParent.children = oldParent.children.filter((cid: string) => cid !== elementId);
      }
    }

    // Add to new parent's children
    if (newParentId && newParentId !== 0) {
      const newParent = elements.find((el: any) => el.id === newParentId);
      if (!newParent) {
        throw new Error(`New parent "${newParentId}" not found on post ${postId}`);
      }
      if (!newParent.children) newParent.children = [];

      if (position !== undefined && position >= 0 && position <= newParent.children.length) {
        newParent.children.splice(position, 0, elementId);
      } else {
        newParent.children.push(elementId);
      }
    }

    element.parent = newParentId;
    await this.setPageElements(postId, elements, postType, site);

    return {
      post_id: postId,
      element_id: elementId,
      old_parent: oldParentId,
      new_parent: newParentId,
      position: position ?? 'end',
      success: true,
    };
  }

  // ===== DUPLICATE ELEMENT =====

  async duplicateElement(postId: number, postType: string = 'pages', elementId: string, newParentId?: string | number, site?: string): Promise<any> {
    const current = await this.getPageElements(postId, postType, site);
    const elements = current.elements || [];

    // Collect element and all descendants
    const idsToClone = new Set<string>();
    const collectDescendants = (id: string) => {
      idsToClone.add(id);
      for (const el of elements) {
        if (el.parent === id) {
          collectDescendants(el.id);
        }
      }
    };
    collectDescendants(elementId);

    const sourceElements = elements.filter((el: any) => idsToClone.has(el.id));
    if (sourceElements.length === 0) {
      throw new Error(`Element "${elementId}" not found on post ${postId}`);
    }

    // Generate new IDs
    const idMap = new Map<string, string>();
    for (const el of sourceElements) {
      idMap.set(el.id, generateElementId());
    }

    // Clone elements with remapped IDs
    const clonedElements = sourceElements.map((el: any) => {
      const newEl = JSON.parse(JSON.stringify(el));
      newEl.id = idMap.get(el.id)!;

      if (typeof newEl.parent === 'string' && idMap.has(newEl.parent)) {
        newEl.parent = idMap.get(newEl.parent)!;
      }

      if (newEl.children && Array.isArray(newEl.children)) {
        newEl.children = newEl.children.map((cid: string) => idMap.get(cid) || cid);
      }

      return newEl;
    });

    // Set the root clone's parent
    const rootClone = clonedElements.find((el: any) => el.id === idMap.get(elementId));
    const targetParentId = newParentId !== undefined ? newParentId : sourceElements[0].parent;
    if (rootClone) {
      rootClone.parent = targetParentId;
    }

    // Add root clone to parent's children
    if (targetParentId && targetParentId !== 0) {
      const parent = elements.find((el: any) => el.id === targetParentId);
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(idMap.get(elementId)!);
      }
    }

    // Append all cloned elements
    elements.push(...clonedElements);
    await this.setPageElements(postId, elements, postType, site);

    return {
      post_id: postId,
      source_element_id: elementId,
      new_element_id: idMap.get(elementId)!,
      duplicated_count: clonedElements.length,
      success: true,
    };
  }

  // ===== ELEMENT TREE =====

  async getElementTree(postId: number, postType: string = 'pages', site?: string): Promise<any> {
    const current = await this.getPageElements(postId, postType, site);
    const elements = current.elements || [];

    const elementMap = new Map<string, any>();
    for (const el of elements) {
      elementMap.set(el.id, { ...el, _children: [] });
    }

    const roots: any[] = [];
    for (const el of elements) {
      const node = elementMap.get(el.id);
      if (el.parent === 0 || el.parent === '0' || !el.parent) {
        roots.push(node);
      } else {
        const parent = elementMap.get(String(el.parent));
        if (parent) {
          parent._children.push(node);
        } else {
          roots.push(node);
        }
      }
    }

    const formatNode = (node: any): any => ({
      id: node.id,
      name: node.name,
      settings_summary: {
        text: node.settings?.text,
        tag: node.settings?.tag,
      },
      children: node._children.map(formatNode),
    });

    return {
      post_id: postId,
      title: current.title,
      tree: roots.map(formatNode),
      total_elements: elements.length,
    };
  }

  // ===== TEMPLATES =====

  async listTemplates(params: any = {}, site?: string): Promise<any> {
    const api = this.getApiClient(site);
    const queryParams: any = { per_page: params.per_page || 100, page: params.page || 1, context: 'edit' };

    if (params.search) {
      queryParams.search = params.search;
    }

    const response = await api.get('/wp/v2/bricks_template', { params: queryParams });

    const total = parseInt(response.headers['x-wp-total'] || '0', 10);
    const totalPages = parseInt(response.headers['x-wp-totalpages'] || '0', 10);

    let templates = trimResponse(response.data).map((t: any) => ({
      id: t.id,
      title: t.title?.rendered || t.title?.raw || '',
      status: t.status,
      type: t.template_type || t.meta?.template_type || 'content',
      modified: t.modified,
    }));

    if (params.template_type) {
      templates = templates.filter((t: any) => t.type === params.template_type);
    }

    return { data: templates, total: templates.length, total_pages: params.template_type ? 1 : totalPages };
  }

  async getTemplate(templateId: number, site?: string): Promise<any> {
    const api = this.getApiClient(site);
    const response = await api.get(`/wp/v2/bricks_template/${templateId}`, { params: { context: 'edit' } });
    const meta = response.data.meta || {};
    const bricksContent = meta._bricks_page_content_2;

    let elements: any[] = [];
    if (bricksContent) {
      elements = typeof bricksContent === 'string' ? JSON.parse(bricksContent) : bricksContent;
    }

    return {
      id: response.data.id,
      title: response.data.title?.rendered || response.data.title?.raw || '',
      status: response.data.status,
      type: response.data.template_type || meta.template_type || 'content',
      elements,
      element_count: elements.length,
    };
  }

  async createTemplate(data: { title: string; elements?: any[]; status?: string; template_type?: string }, site?: string): Promise<any> {
    const api = this.getApiClient(site);
    const payload: any = {
      title: data.title,
      status: data.status || 'publish',
    };

    const meta: any = {};
    if (data.elements) {
      meta._bricks_page_content_2 = JSON.stringify(data.elements);
    }
    if (data.template_type) {
      meta._bricks_template_type = data.template_type;
    }
    if (Object.keys(meta).length > 0) {
      payload.meta = meta;
    }

    const response = await api.post('/wp/v2/bricks_template', payload);

    return {
      id: response.data.id,
      title: response.data.title?.rendered || response.data.title?.raw || '',
      status: response.data.status,
      element_count: data.elements?.length || 0,
      success: true,
    };
  }

  async updateTemplate(templateId: number, data: { elements?: any[]; title?: string; status?: string }, site?: string): Promise<any> {
    const api = this.getApiClient(site);
    const payload: any = {};

    if (data.title) payload.title = data.title;
    if (data.status) payload.status = data.status;
    if (data.elements) {
      payload.meta = {
        _bricks_page_content_2: JSON.stringify(data.elements),
      };
    }

    const response = await api.post(`/wp/v2/bricks_template/${templateId}`, payload);

    return {
      id: response.data.id,
      title: response.data.title?.rendered || response.data.title?.raw || '',
      status: response.data.status,
      success: true,
    };
  }

  async deleteTemplate(templateId: number, site?: string): Promise<any> {
    const api = this.getApiClient(site);
    const response = await api.delete(`/wp/v2/bricks_template/${templateId}`, { params: { force: true } });
    return { id: templateId, deleted: true, success: true };
  }

  // ===== PAGE MANAGEMENT =====

  async listPages(params: any = {}, site?: string): Promise<any> {
    const api = this.getApiClient(site);
    const queryParams: any = { per_page: params.per_page || 100, page: params.page || 1, context: 'edit' };

    if (params.search) {
      queryParams.search = params.search;
    }

    const response = await api.get('/wp/v2/pages', { params: queryParams });

    const total = parseInt(response.headers['x-wp-total'] || '0', 10);
    const totalPages = parseInt(response.headers['x-wp-totalpages'] || '0', 10);

    let pages = trimResponse(response.data);

    if (!params.include_all) {
      pages = pages.filter((p: any) => {
        const meta = p.meta || {};
        return meta._bricks_page_content_2 && meta._bricks_page_content_2 !== '[]' && meta._bricks_page_content_2 !== '';
      });
    }

    const mappedPages = pages.map((p: any) => {
      const meta = p.meta || {};
      const bricksContent = meta._bricks_page_content_2;
      let elementCount = 0;
      try {
        const els = typeof bricksContent === 'string' ? JSON.parse(bricksContent) : bricksContent;
        elementCount = Array.isArray(els) ? els.length : 0;
      } catch { /* ignore */ }

      return {
        id: p.id,
        title: p.title?.rendered || p.title?.raw || '',
        status: p.status,
        slug: p.slug,
        link: p.link,
        element_count: elementCount,
        modified: p.modified,
      };
    });

    return { data: mappedPages, total: mappedPages.length, total_pages: params.include_all ? totalPages : 1 };
  }

  async createPage(data: { title: string; elements?: any[]; status?: string; slug?: string; parent?: number }, site?: string): Promise<any> {
    const api = this.getApiClient(site);
    const payload: any = {
      title: data.title,
      status: data.status || 'draft',
    };

    if (data.slug) payload.slug = data.slug;
    if (data.parent) payload.parent = data.parent;

    if (data.elements) {
      payload.meta = {
        _bricks_page_content_2: JSON.stringify(data.elements),
      };
    }

    const response = await api.post('/wp/v2/pages', payload);

    return {
      id: response.data.id,
      title: response.data.title?.rendered || response.data.title?.raw || '',
      status: response.data.status,
      slug: response.data.slug,
      link: response.data.link,
      element_count: data.elements?.length || 0,
      success: true,
    };
  }

  async clonePage(sourcePostId: number, newTitle: string, postType: string = 'pages', site?: string): Promise<any> {
    const normalizedPostType = normalizePostType(postType);
    const source = await this.getPageElements(sourcePostId, normalizedPostType, site);

    // Re-generate all element IDs to avoid conflicts
    const idMap = new Map<string, string>();
    const clonedElements = source.elements.map((el: any) => {
      const newId = generateElementId();
      idMap.set(el.id, newId);
      return { ...el, id: newId };
    });

    // Remap parent references and children arrays
    for (const el of clonedElements) {
      if (typeof el.parent === 'string' && idMap.has(el.parent)) {
        el.parent = idMap.get(el.parent)!;
      }
      if (el.children && Array.isArray(el.children)) {
        el.children = el.children.map((cid: string) => idMap.get(cid) || cid);
      }
    }

    // Create clone using the same post type as source
    const api = this.getApiClient(site);
    const endpoint = getPostTypeEndpoint(normalizedPostType);
    const payload: any = {
      title: newTitle,
      status: 'draft',
      meta: {
        _bricks_page_content_2: JSON.stringify(clonedElements),
      },
    };
    const response = await api.post(endpoint, payload);

    return {
      id: response.data.id,
      title: response.data.title?.rendered || response.data.title?.raw || '',
      status: response.data.status,
      post_type: normalizedPostType,
      source_post_id: sourcePostId,
      cloned_elements: clonedElements.length,
      success: true,
    };
  }

  // ===== CSS / STYLES =====

  async getGlobalClasses(site?: string): Promise<any> {
    const api = this.getApiClient(site);
    // Global classes are stored in wp_options as bricks_global_classes
    // Try via WordPress settings API or custom endpoint
    try {
      const response = await api.get('/bricks/v1/get-global-classes');
      return response.data;
    } catch {
      // Fallback: try wp_options via settings endpoint
      try {
        const response = await api.get('/wp/v2/settings');
        if (response.data.bricks_global_classes) {
          return typeof response.data.bricks_global_classes === 'string'
            ? JSON.parse(response.data.bricks_global_classes)
            : response.data.bricks_global_classes;
        }
      } catch { /* ignore */ }

      return {
        error: 'Could not retrieve global classes. You may need a custom REST endpoint or the Bricks REST API enabled.',
        suggestion: 'Add a custom endpoint via a WordPress plugin that reads get_option("bricks_global_classes") and returns it as JSON.',
      };
    }
  }

  async getPageCss(postId: number, postType: string = 'pages', site?: string): Promise<any> {
    const api = this.getApiClient(site);
    const normalizedPostType = normalizePostType(postType);
    const endpoint = getPostTypeEndpoint(normalizedPostType, postId);
    const response = await api.get(endpoint, { params: { context: 'edit' } });
    const meta = response.data.meta || {};

    return {
      post_id: postId,
      post_type: normalizedPostType,
      css: meta._bricks_page_css_2 || '',
    };
  }

  async setPageCss(postId: number, css: string, postType: string = 'pages', site?: string): Promise<any> {
    const api = this.getApiClient(site);
    const normalizedPostType = normalizePostType(postType);
    const endpoint = getPostTypeEndpoint(normalizedPostType, postId);
    const response = await api.post(endpoint, {
      meta: {
        _bricks_page_css_2: css,
      },
    });

    return {
      post_id: postId,
      post_type: normalizedPostType,
      success: true,
    };
  }

  // ===== SITE SETTINGS =====

  async getSettings(site?: string): Promise<any> {
    const api = this.getApiClient(site);
    try {
      const response = await api.get('/bricks/v1/get-settings');
      return response.data;
    } catch {
      try {
        const response = await api.get('/wp/v2/settings');
        if (response.data.bricks_global_settings) {
          return typeof response.data.bricks_global_settings === 'string'
            ? JSON.parse(response.data.bricks_global_settings)
            : response.data.bricks_global_settings;
        }
      } catch { /* ignore */ }

      return {
        error: 'Could not retrieve Bricks settings. You may need a custom REST endpoint or the Bricks REST API enabled.',
        suggestion: 'Add a custom endpoint via a WordPress plugin that reads get_option("bricks_global_settings") and returns it as JSON.',
      };
    }
  }
}

// ===== MCP SERVER SETUP =====

const server = new Server(
  {
    name: 'bricks-mcp',
    version: '2.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const client = new BricksClient();

const siteProperty = {
  type: 'string' as const,
  description: `Site key for multi-site support. Available: ${Array.from(siteConfigs.keys()).join(', ')}. Defaults to "${defaultSite}".`,
};

const postTypeProperty = {
  type: 'string' as const,
  description: 'Post type slug. Use "pages" for pages, "posts" for posts, or any registered CPT slug (e.g., "product", "portfolio"). Defaults to "pages".',
};

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // ===== PAGE/POST BRICKS CONTENT =====
      {
        name: 'bricks_get_page_elements',
        description: 'Get the Bricks elements array for a page/post by ID. Returns the structured JSON of all elements on that page.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            post_id: { type: 'number', description: 'The page/post ID' },
            post_type: postTypeProperty,
          },
          required: ['post_id'],
        },
      },
      {
        name: 'bricks_set_page_elements',
        description: 'Set/replace the entire Bricks elements array for a page/post. Takes the full elements JSON array.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            post_id: { type: 'number', description: 'The page/post ID' },
            elements: { type: 'array', description: 'Full array of Bricks elements to set', items: { type: 'object' } },
            post_type: postTypeProperty,
          },
          required: ['post_id', 'elements'],
        },
      },
      {
        name: 'bricks_add_element',
        description: 'Add a single element to a page. Appends to existing elements. If the element has a parent, it will be added to the parent\'s children array automatically. Includes validation warnings.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            post_id: { type: 'number', description: 'The page/post ID' },
            element: {
              type: 'object',
              description: 'Bricks element object with name, settings, parent. ID will be auto-generated if not provided.',
              properties: {
                id: { type: 'string', description: 'Element ID (auto-generated if omitted)' },
                name: { type: 'string', description: 'Element type name (e.g., "heading", "text-basic", "container")' },
                parent: { type: ['string', 'number'], description: 'Parent element ID or 0 for root' },
                children: { type: 'array', items: { type: 'string' }, description: 'Child element IDs' },
                settings: { type: 'object', description: 'Element settings object' },
              },
              required: ['name', 'settings'],
            },
            post_type: postTypeProperty,
          },
          required: ['post_id', 'element'],
        },
      },
      {
        name: 'bricks_remove_element',
        description: 'Remove an element by its element ID from a page. Also removes all descendant elements.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            post_id: { type: 'number', description: 'The page/post ID' },
            element_id: { type: 'string', description: 'The Bricks element ID to remove' },
            post_type: postTypeProperty,
          },
          required: ['post_id', 'element_id'],
        },
      },
      {
        name: 'bricks_update_element',
        description: 'Update a specific element\'s settings on a page (by element ID). Merges new settings with existing ones.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            post_id: { type: 'number', description: 'The page/post ID' },
            element_id: { type: 'string', description: 'The Bricks element ID to update' },
            settings: { type: 'object', description: 'Settings to merge into the element\'s existing settings' },
            post_type: postTypeProperty,
          },
          required: ['post_id', 'element_id', 'settings'],
        },
      },
      {
        name: 'bricks_find_element',
        description: 'Search elements within a page by type, text content, or CSS class. Returns matching elements with their IDs, settings summary, and parent chain.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            post_id: { type: 'number', description: 'The page/post ID' },
            post_type: postTypeProperty,
            element_type: { type: 'string', description: 'Filter by element type name (e.g., "heading", "button")' },
            text_search: { type: 'string', description: 'Search for text content within element settings' },
            css_class: { type: 'string', description: 'Filter by CSS class name' },
          },
          required: ['post_id'],
        },
      },
      {
        name: 'bricks_bulk_update_elements',
        description: 'Update settings on multiple elements at once. Accepts an array of {element_id, settings} objects. Includes validation warnings.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            post_id: { type: 'number', description: 'The page/post ID' },
            post_type: postTypeProperty,
            updates: {
              type: 'array',
              description: 'Array of updates, each with element_id and settings to merge',
              items: {
                type: 'object',
                properties: {
                  element_id: { type: 'string', description: 'The element ID to update' },
                  settings: { type: 'object', description: 'Settings to merge' },
                },
                required: ['element_id', 'settings'],
              },
            },
          },
          required: ['post_id', 'updates'],
        },
      },
      {
        name: 'bricks_move_element',
        description: 'Move an element to a different parent or position within parent\'s children array.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            post_id: { type: 'number', description: 'The page/post ID' },
            post_type: postTypeProperty,
            element_id: { type: 'string', description: 'The element ID to move' },
            new_parent_id: { type: ['string', 'number'], description: 'The new parent element ID or 0 for root' },
            position: { type: 'number', description: 'Position index in new parent\'s children (optional, defaults to end)' },
          },
          required: ['post_id', 'element_id', 'new_parent_id'],
        },
      },
      {
        name: 'bricks_duplicate_element',
        description: 'Duplicate an element and all its descendants within the same page. New IDs are generated for all duplicated elements.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            post_id: { type: 'number', description: 'The page/post ID' },
            post_type: postTypeProperty,
            element_id: { type: 'string', description: 'The element ID to duplicate' },
            new_parent_id: { type: ['string', 'number'], description: 'Optional new parent for the duplicated element (defaults to same parent)' },
          },
          required: ['post_id', 'element_id'],
        },
      },
      {
        name: 'bricks_get_element_tree',
        description: 'Get a hierarchical tree representation of page elements (nested, not flat array). Useful for understanding page structure.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            post_id: { type: 'number', description: 'The page/post ID' },
            post_type: postTypeProperty,
          },
          required: ['post_id'],
        },
      },
      {
        name: 'bricks_snapshot_page',
        description: 'Save a snapshot of all page elements before making changes. Stored in post meta. Use bricks_restore_snapshot to roll back.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            post_id: { type: 'number', description: 'The page/post ID' },
            post_type: postTypeProperty,
            label: { type: 'string', description: 'Optional label/description for this snapshot' },
          },
          required: ['post_id'],
        },
      },
      {
        name: 'bricks_restore_snapshot',
        description: 'Restore page elements from a previously saved snapshot.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            post_id: { type: 'number', description: 'The page/post ID' },
            post_type: postTypeProperty,
            snapshot_key: { type: 'string', description: 'The snapshot key (e.g., "_bricks_snapshot_1234567890")' },
          },
          required: ['post_id', 'snapshot_key'],
        },
      },
      {
        name: 'bricks_list_snapshots',
        description: 'List all available snapshots for a page, sorted by most recent first.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            post_id: { type: 'number', description: 'The page/post ID' },
            post_type: postTypeProperty,
          },
          required: ['post_id'],
        },
      },

      {
        name: 'bricks_delete_snapshot',
        description: 'Delete a specific snapshot from a page.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            post_id: { type: 'number', description: 'The page/post ID' },
            post_type: postTypeProperty,
            snapshot_key: { type: 'string', description: 'The snapshot key to delete (e.g. _bricks_snapshot_1234567890)' },
          },
          required: ['post_id', 'snapshot_key'],
        },
      },

      // ===== TEMPLATES =====
      {
        name: 'bricks_list_templates',
        description: 'List Bricks templates (headers, footers, sections, content templates). Supports filtering by template_type and search. Returns pagination totals.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            per_page: { type: 'number', description: 'Results per page (default: 100)' },
            page: { type: 'number', description: 'Page number (default: 1)' },
            template_type: { type: 'string', description: 'Filter by template type', enum: ['header', 'footer', 'section', 'content', 'popup'] },
            search: { type: 'string', description: 'Search templates by title' },
          },
        },
      },
      {
        name: 'bricks_get_template',
        description: 'Get template details including its Bricks elements array.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            template_id: { type: 'number', description: 'The Bricks template ID' },
          },
          required: ['template_id'],
        },
      },
      {
        name: 'bricks_create_template',
        description: 'Create a new Bricks template with elements.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            title: { type: 'string', description: 'Template title' },
            elements: { type: 'array', description: 'Array of Bricks elements', items: { type: 'object' } },
            status: { type: 'string', description: 'Post status (default: "publish")', enum: ['publish', 'draft', 'private'] },
            template_type: { type: 'string', description: 'Template type: header, footer, section, content', enum: ['header', 'footer', 'section', 'content', 'popup'] },
          },
          required: ['title'],
        },
      },
      {
        name: 'bricks_update_template',
        description: 'Update a Bricks template\'s elements, title, or status.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            template_id: { type: 'number', description: 'The template ID to update' },
            title: { type: 'string', description: 'New title (optional)' },
            elements: { type: 'array', description: 'New elements array (optional)', items: { type: 'object' } },
            status: { type: 'string', description: 'New status (optional)', enum: ['publish', 'draft', 'private'] },
          },
          required: ['template_id'],
        },
      },
      {
        name: 'bricks_delete_template',
        description: 'Delete a Bricks template permanently.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            template_id: { type: 'number', description: 'The template ID to delete' },
          },
          required: ['template_id'],
        },
      },

      // ===== ELEMENT HELPERS (LOCAL) =====
      {
        name: 'bricks_list_element_types',
        description: 'List available Bricks element types with their default settings structure and examples. LOCAL tool — no API call. Use this to learn which elements and properties are available.',
        inputSchema: {
          type: 'object',
          properties: {
            filter: { type: 'string', description: 'Optional filter by element name (e.g., "heading", "container")' },
          },
        },
      },
      {
        name: 'bricks_generate_section',
        description: 'Generate a complete section structure from a type. Returns a ready-to-use Bricks elements array. LOCAL helper — no API call. Types: hero, features, pricing, cta, testimonials, faq, contact, stats, team, logos, newsletter, comparison, steps, footer.',
        inputSchema: {
          type: 'object',
          properties: {
            section_type: {
              type: 'string',
              description: 'Section type to generate',
              enum: ['hero', 'features', 'pricing', 'cta', 'testimonials', 'faq', 'contact', 'stats', 'team', 'logos', 'newsletter', 'comparison', 'steps', 'footer'],
            },
            heading: { type: 'string', description: 'Custom heading text (optional)' },
            text: { type: 'string', description: 'Custom body text (optional, for hero/cta/contact/newsletter)' },
            buttonText: { type: 'string', description: 'Custom button text (optional, for hero/cta/newsletter/contact)' },
            buttonUrl: { type: 'string', description: 'Custom button URL (optional, for hero/cta)' },
            features: {
              type: 'array',
              description: 'Custom features array for "features" section type',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
            testimonials: {
              type: 'array',
              description: 'Custom testimonials for "testimonials" section type',
              items: {
                type: 'object',
                properties: {
                  quote: { type: 'string' },
                  author: { type: 'string' },
                  role: { type: 'string' },
                },
              },
            },
            faqs: {
              type: 'array',
              description: 'Custom FAQ items for "faq" section type',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  content: { type: 'string' },
                },
              },
            },
            plans: {
              type: 'array',
              description: 'Custom pricing plans for "pricing" section type',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  price: { type: 'string' },
                  features: { type: 'array', items: { type: 'string' } },
                  buttonText: { type: 'string' },
                  highlighted: { type: 'boolean' },
                },
              },
            },
            stats: {
              type: 'array',
              description: 'Custom stats for "stats" section type',
              items: {
                type: 'object',
                properties: {
                  number: { type: 'string' },
                  label: { type: 'string' },
                },
              },
            },
            members: {
              type: 'array',
              description: 'Custom team members for "team" section type',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  role: { type: 'string' },
                  image: { type: 'string' },
                },
              },
            },
            steps: {
              type: 'array',
              description: 'Custom steps for "steps" section type',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
            columns: {
              type: 'array',
              description: 'Column headers for "comparison" section type',
              items: { type: 'string' },
            },
            rows: {
              type: 'array',
              description: 'Row data for "comparison" section type',
              items: {
                type: 'object',
                properties: {
                  feature: { type: 'string' },
                  values: { type: 'array', items: {} },
                },
              },
            },
            links: {
              type: 'array',
              description: 'Footer links for "footer" section type',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  url: { type: 'string' },
                },
              },
            },
            logos: {
              type: 'array',
              description: 'Logo URLs for "logos" section type',
              items: {
                type: 'object',
                properties: {
                  url: { type: 'string' },
                },
              },
            },
            logoCount: { type: 'number', description: 'Number of logo placeholders for "logos" section (default: 5)' },
            backgroundColor: { type: 'string', description: 'Background color (for cta, newsletter, footer sections)' },
            numberColor: { type: 'string', description: 'Color for stat numbers (for stats section)' },
            stepColor: { type: 'string', description: 'Color for step circles (for steps section)' },
            siteName: { type: 'string', description: 'Site/brand name for footer section' },
            aboutText: { type: 'string', description: 'About text for footer section' },
            email: { type: 'string', description: 'Email for footer contact section' },
            phone: { type: 'string', description: 'Phone for footer contact section' },
            socialText: { type: 'string', description: 'Social media text for footer section' },
            placeholder: { type: 'string', description: 'Input placeholder text for newsletter section' },
          },
          required: ['section_type'],
        },
      },
      {
        name: 'bricks_generate_element',
        description: 'Generate a single Bricks element JSON from parameters. LOCAL helper — no API call. Returns a ready-to-use element object with auto-generated ID.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Element type name (e.g., "heading", "text-basic", "button", "container", "section")' },
            parent: { type: ['string', 'number'], description: 'Parent element ID or 0 for root (default: 0)' },
            children: { type: 'array', items: { type: 'string' }, description: 'Child element IDs (optional)' },
            settings: { type: 'object', description: 'Element settings (merged with defaults for the element type)' },
          },
          required: ['name'],
        },
      },

      // ===== PAGE MANAGEMENT =====
      {
        name: 'bricks_list_pages',
        description: 'List pages. By default only shows pages with Bricks content. Set include_all=true to include all pages. Supports search. Returns pagination totals.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            per_page: { type: 'number', description: 'Results per page (default: 100)' },
            page: { type: 'number', description: 'Page number (default: 1)' },
            include_all: { type: 'boolean', description: 'Include pages without Bricks content (default: false)' },
            search: { type: 'string', description: 'Search pages by title' },
          },
        },
      },
      {
        name: 'bricks_create_page',
        description: 'Create a new WordPress page with Bricks content. The page will use Bricks Builder for rendering.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            title: { type: 'string', description: 'Page title' },
            elements: { type: 'array', description: 'Array of Bricks elements (optional)', items: { type: 'object' } },
            status: { type: 'string', description: 'Page status (default: "draft")', enum: ['publish', 'draft', 'private', 'pending'] },
            slug: { type: 'string', description: 'Page slug (optional)' },
            parent: { type: 'number', description: 'Parent page ID (optional)' },
          },
          required: ['title'],
        },
      },
      {
        name: 'bricks_clone_page',
        description: 'Clone a page\'s Bricks content to a new page. All element IDs are regenerated to avoid conflicts.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            source_post_id: { type: 'number', description: 'Source page/post ID to clone from' },
            new_title: { type: 'string', description: 'Title for the new cloned page' },
            post_type: postTypeProperty,
          },
          required: ['source_post_id', 'new_title'],
        },
      },

      // ===== CSS / STYLES =====
      {
        name: 'bricks_get_global_classes',
        description: 'Get Bricks global CSS classes (stored in wp_options as bricks_global_classes). May require a custom REST endpoint if not exposed by default.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
          },
        },
      },
      {
        name: 'bricks_get_page_css',
        description: 'Get custom CSS for a page (stored in _bricks_page_css_2 post meta).',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            post_id: { type: 'number', description: 'The page/post ID' },
            post_type: postTypeProperty,
          },
          required: ['post_id'],
        },
      },
      {
        name: 'bricks_set_page_css',
        description: 'Set custom CSS for a page (stored in _bricks_page_css_2 post meta).',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            post_id: { type: 'number', description: 'The page/post ID' },
            css: { type: 'string', description: 'CSS code to set for the page' },
            post_type: postTypeProperty,
          },
          required: ['post_id', 'css'],
        },
      },

      // ===== SITE SETTINGS =====
      {
        name: 'bricks_get_settings',
        description: 'Get Bricks global settings (stored in wp_options as bricks_global_settings). May require a custom REST endpoint if not exposed by default.',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ===== PAGE/POST BRICKS CONTENT =====
      case 'bricks_get_page_elements':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              await client.getPageElements((args as any).post_id, (args as any)?.post_type, (args as any)?.site),
              null, 2,
            ),
          }],
        };

      case 'bricks_set_page_elements':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              await client.setPageElements((args as any).post_id, (args as any).elements, (args as any)?.post_type, (args as any)?.site),
              null, 2,
            ),
          }],
        };

      case 'bricks_add_element':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              await client.addElement((args as any).post_id, (args as any).element, (args as any)?.post_type, (args as any)?.site),
              null, 2,
            ),
          }],
        };

      case 'bricks_remove_element':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              await client.removeElement((args as any).post_id, (args as any).element_id, (args as any)?.post_type, (args as any)?.site),
              null, 2,
            ),
          }],
        };

      case 'bricks_update_element':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              await client.updateElement((args as any).post_id, (args as any).element_id, (args as any).settings, (args as any)?.post_type, (args as any)?.site),
              null, 2,
            ),
          }],
        };

      case 'bricks_find_element':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              await client.findElement(
                (args as any).post_id,
                (args as any)?.post_type,
                {
                  element_type: (args as any)?.element_type,
                  text_search: (args as any)?.text_search,
                  css_class: (args as any)?.css_class,
                },
                (args as any)?.site,
              ),
              null, 2,
            ),
          }],
        };

      case 'bricks_bulk_update_elements':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              await client.bulkUpdateElements((args as any).post_id, (args as any)?.post_type, (args as any).updates, (args as any)?.site),
              null, 2,
            ),
          }],
        };

      case 'bricks_move_element':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              await client.moveElement((args as any).post_id, (args as any)?.post_type, (args as any).element_id, (args as any).new_parent_id, (args as any)?.position, (args as any)?.site),
              null, 2,
            ),
          }],
        };

      case 'bricks_duplicate_element':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              await client.duplicateElement((args as any).post_id, (args as any)?.post_type, (args as any).element_id, (args as any)?.new_parent_id, (args as any)?.site),
              null, 2,
            ),
          }],
        };

      case 'bricks_get_element_tree':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              await client.getElementTree((args as any).post_id, (args as any)?.post_type, (args as any)?.site),
              null, 2,
            ),
          }],
        };

      case 'bricks_snapshot_page':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              await client.snapshotPage((args as any).post_id, (args as any)?.post_type, (args as any)?.label, (args as any)?.site),
              null, 2,
            ),
          }],
        };

      case 'bricks_restore_snapshot':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              await client.restoreSnapshot((args as any).post_id, (args as any)?.post_type, (args as any).snapshot_key, (args as any)?.site),
              null, 2,
            ),
          }],
        };

      case 'bricks_list_snapshots':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              await client.listSnapshots((args as any).post_id, (args as any)?.post_type, (args as any)?.site),
              null, 2,
            ),
          }],
        };

      case 'bricks_delete_snapshot':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              await client.deleteSnapshot((args as any).post_id, (args as any).snapshot_key, (args as any)?.post_type, (args as any)?.site),
              null, 2,
            ),
          }],
        };

      // ===== TEMPLATES =====
      case 'bricks_list_templates':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(await client.listTemplates(args || {}, (args as any)?.site), null, 2),
          }],
        };

      case 'bricks_get_template':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(await client.getTemplate((args as any).template_id, (args as any)?.site), null, 2),
          }],
        };

      case 'bricks_create_template':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(await client.createTemplate(args as any, (args as any)?.site), null, 2),
          }],
        };

      case 'bricks_update_template':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              await client.updateTemplate((args as any).template_id, args as any, (args as any)?.site),
              null, 2,
            ),
          }],
        };

      case 'bricks_delete_template':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(await client.deleteTemplate((args as any).template_id, (args as any)?.site), null, 2),
          }],
        };

      // ===== ELEMENT HELPERS (LOCAL) =====
      case 'bricks_list_element_types': {
        let types = BRICKS_ELEMENT_TYPES;
        const filter = (args as any)?.filter;
        if (filter) {
          types = types.filter(t => t.name.includes(filter.toLowerCase()));
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(types, null, 2),
          }],
        };
      }

      case 'bricks_generate_section': {
        const sectionType = (args as any).section_type;
        const elements = generateSection(sectionType, args as any);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ section_type: sectionType, elements, element_count: elements.length }, null, 2),
          }],
        };
      }

      case 'bricks_generate_element': {
        const elementName = (args as any).name;
        const typeRef = BRICKS_ELEMENT_TYPES.find(t => t.name === elementName);
        const defaultSettings = typeRef?.defaultSettings || {};
        const element: BricksElement = {
          id: generateElementId(),
          name: elementName,
          parent: (args as any)?.parent || 0,
          settings: { ...defaultSettings, ...((args as any)?.settings || {}) },
        };
        if ((args as any)?.children) {
          element.children = (args as any).children;
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(element, null, 2),
          }],
        };
      }

      // ===== PAGE MANAGEMENT =====
      case 'bricks_list_pages':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(await client.listPages(args || {}, (args as any)?.site), null, 2),
          }],
        };

      case 'bricks_create_page':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(await client.createPage(args as any, (args as any)?.site), null, 2),
          }],
        };

      case 'bricks_clone_page':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              await client.clonePage((args as any).source_post_id, (args as any).new_title, (args as any)?.post_type, (args as any)?.site),
              null, 2,
            ),
          }],
        };

      // ===== CSS / STYLES =====
      case 'bricks_get_global_classes':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(await client.getGlobalClasses((args as any)?.site), null, 2),
          }],
        };

      case 'bricks_get_page_css':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              await client.getPageCss((args as any).post_id, (args as any)?.post_type, (args as any)?.site),
              null, 2,
            ),
          }],
        };

      case 'bricks_set_page_css':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              await client.setPageCss((args as any).post_id, (args as any).css, (args as any)?.post_type, (args as any)?.site),
              null, 2,
            ),
          }],
        };

      // ===== SITE SETTINGS =====
      case 'bricks_get_settings':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(await client.getSettings((args as any)?.site), null, 2),
          }],
        };

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Bricks MCP Server v2.0.0 running on stdio');
  console.error(`Configured sites: ${Array.from(siteConfigs.keys()).join(', ')}`);
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
