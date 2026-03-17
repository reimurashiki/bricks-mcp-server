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

    default:
      throw new Error(`Unknown section type: "${sectionType}". Available: hero, features, pricing, cta, testimonials, faq`);
  }
}

// ===== BRICKS API CLIENT =====

class BricksClient {
  private clients: Map<string, AxiosInstance> = new Map();

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
    const endpoint = postType === 'pages' ? `/wp/v2/pages/${postId}` : `/wp/v2/posts/${postId}`;
    const response = await api.get(endpoint, { params: { context: 'edit' } });
    const meta = response.data.meta || {};
    const bricksContent = meta._bricks_page_content_2;

    let elements: any[] = [];
    if (bricksContent) {
      elements = typeof bricksContent === 'string' ? JSON.parse(bricksContent) : bricksContent;
    }

    return {
      post_id: response.data.id,
      title: response.data.title?.rendered || response.data.title?.raw || '',
      status: response.data.status,
      elements,
      element_count: elements.length,
    };
  }

  async setPageElements(postId: number, elements: any[], postType: string = 'pages', site?: string): Promise<any> {
    const api = this.getApiClient(site);
    const endpoint = postType === 'pages' ? `/wp/v2/pages/${postId}` : `/wp/v2/posts/${postId}`;
    const response = await api.post(endpoint, {
      meta: {
        _bricks_page_content_2: JSON.stringify(elements),
      },
    });

    return {
      post_id: response.data.id,
      title: response.data.title?.rendered || response.data.title?.raw || '',
      status: response.data.status,
      element_count: elements.length,
      success: true,
    };
  }

  async addElement(postId: number, element: any, postType: string = 'pages', site?: string): Promise<any> {
    const current = await this.getPageElements(postId, postType, site);
    const elements = current.elements || [];

    if (!element.id) {
      element.id = generateElementId();
    }

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

    return {
      post_id: postId,
      added_element_id: element.id,
      total_elements: elements.length,
      success: true,
    };
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

  // ===== TEMPLATES =====

  async listTemplates(params: any = {}, site?: string): Promise<any> {
    const api = this.getApiClient(site);
    const response = await api.get('/wp/v2/bricks_template', {
      params: { per_page: params.per_page || 100, page: params.page || 1, context: 'edit', ...params },
    });

    return response.data.map((t: any) => ({
      id: t.id,
      title: t.title?.rendered || t.title?.raw || '',
      status: t.status,
      type: t.template_type || t.meta?.template_type || 'content',
      modified: t.modified,
    }));
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

    if (data.elements) {
      payload.meta = {
        _bricks_page_content_2: JSON.stringify(data.elements),
      };
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
    const response = await api.get('/wp/v2/pages', {
      params: { per_page: params.per_page || 100, page: params.page || 1, context: 'edit', ...params },
    });

    const pages = response.data
      .filter((p: any) => {
        const meta = p.meta || {};
        return meta._bricks_page_content_2 && meta._bricks_page_content_2 !== '[]' && meta._bricks_page_content_2 !== '';
      })
      .map((p: any) => {
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

    return { pages, total: pages.length };
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
    const source = await this.getPageElements(sourcePostId, postType, site);

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

    const result = await this.createPage({ title: newTitle, elements: clonedElements }, site);

    return {
      ...result,
      source_post_id: sourcePostId,
      cloned_elements: clonedElements.length,
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
    const endpoint = postType === 'pages' ? `/wp/v2/pages/${postId}` : `/wp/v2/posts/${postId}`;
    const response = await api.get(endpoint, { params: { context: 'edit' } });
    const meta = response.data.meta || {};

    return {
      post_id: postId,
      css: meta._bricks_page_css_2 || '',
    };
  }

  async setPageCss(postId: number, css: string, postType: string = 'pages', site?: string): Promise<any> {
    const api = this.getApiClient(site);
    const endpoint = postType === 'pages' ? `/wp/v2/pages/${postId}` : `/wp/v2/posts/${postId}`;
    const response = await api.post(endpoint, {
      meta: {
        _bricks_page_css_2: css,
      },
    });

    return {
      post_id: postId,
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
    version: '1.0.0',
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
            post_type: { type: 'string', description: 'Post type: "pages" or "posts" (default: "pages")', enum: ['pages', 'posts'] },
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
            post_type: { type: 'string', description: 'Post type: "pages" or "posts" (default: "pages")', enum: ['pages', 'posts'] },
          },
          required: ['post_id', 'elements'],
        },
      },
      {
        name: 'bricks_add_element',
        description: 'Add a single element to a page. Appends to existing elements. If the element has a parent, it will be added to the parent\'s children array automatically.',
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
            post_type: { type: 'string', description: 'Post type: "pages" or "posts" (default: "pages")', enum: ['pages', 'posts'] },
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
            post_type: { type: 'string', description: 'Post type: "pages" or "posts" (default: "pages")', enum: ['pages', 'posts'] },
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
            post_type: { type: 'string', description: 'Post type: "pages" or "posts" (default: "pages")', enum: ['pages', 'posts'] },
          },
          required: ['post_id', 'element_id', 'settings'],
        },
      },

      // ===== TEMPLATES =====
      {
        name: 'bricks_list_templates',
        description: 'List all Bricks templates (headers, footers, sections, content templates).',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            per_page: { type: 'number', description: 'Results per page (default: 100)' },
            page: { type: 'number', description: 'Page number (default: 1)' },
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
            template_type: { type: 'string', description: 'Template type: header, footer, section, content', enum: ['header', 'footer', 'section', 'content'] },
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
        description: 'Generate a complete section structure from a type. Returns a ready-to-use Bricks elements array. LOCAL helper — no API call. Types: hero, features, pricing, cta, testimonials, faq.',
        inputSchema: {
          type: 'object',
          properties: {
            section_type: {
              type: 'string',
              description: 'Section type to generate',
              enum: ['hero', 'features', 'pricing', 'cta', 'testimonials', 'faq'],
            },
            heading: { type: 'string', description: 'Custom heading text (optional)' },
            text: { type: 'string', description: 'Custom body text (optional, for hero/cta)' },
            buttonText: { type: 'string', description: 'Custom button text (optional, for hero/cta)' },
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
            backgroundColor: { type: 'string', description: 'Background color for CTA section (optional)' },
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
        description: 'List all pages that have Bricks content (non-empty Bricks elements).',
        inputSchema: {
          type: 'object',
          properties: {
            site: siteProperty,
            per_page: { type: 'number', description: 'Results per page (default: 100)' },
            page: { type: 'number', description: 'Page number (default: 1)' },
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
            post_type: { type: 'string', description: 'Post type of source: "pages" or "posts" (default: "pages")', enum: ['pages', 'posts'] },
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
            post_type: { type: 'string', description: 'Post type: "pages" or "posts" (default: "pages")', enum: ['pages', 'posts'] },
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
            post_type: { type: 'string', description: 'Post type: "pages" or "posts" (default: "pages")', enum: ['pages', 'posts'] },
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
  console.error('Bricks MCP Server running on stdio');
  console.error(`Configured sites: ${Array.from(siteConfigs.keys()).join(', ')}`);
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
