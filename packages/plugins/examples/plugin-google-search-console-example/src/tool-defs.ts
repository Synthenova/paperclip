import type { PluginToolDeclaration } from "@paperclipai/plugin-sdk";

export const GSC_TOOL_DEFINITIONS: PluginToolDeclaration[] = [
  {
    name: "list_properties",
    displayName: "List Search Console Properties",
    description: "Retrieve the Search Console properties visible to the configured Google account.",
    parametersSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "add_site",
    displayName: "Add Search Console Property",
    description: "Add a new site or domain property to Google Search Console.",
    parametersSchema: {
      type: "object",
      properties: {
        site_url: { title: "Site Url", type: "string" },
      },
      required: ["site_url"],
    },
  },
  {
    name: "delete_site",
    displayName: "Remove Search Console Property",
    description: "Remove an existing site or domain property from Google Search Console.",
    parametersSchema: {
      type: "object",
      properties: {
        site_url: { title: "Site Url", type: "string" },
      },
      required: ["site_url"],
    },
  },
  {
    name: "get_search_analytics",
    displayName: "Get Search Analytics",
    description: "Fetch search analytics for a property, grouped by one or more dimensions.",
    parametersSchema: {
      type: "object",
      properties: {
        site_url: { title: "Site Url", type: "string" },
        days: { default: 28, title: "Days", type: "integer" },
        dimensions: { default: "query", title: "Dimensions", type: "string" },
      },
      required: ["site_url"],
    },
  },
  {
    name: "get_site_details",
    displayName: "Get Property Details",
    description: "Fetch detailed metadata for a Search Console property.",
    parametersSchema: {
      type: "object",
      properties: {
        site_url: { title: "Site Url", type: "string" },
      },
      required: ["site_url"],
    },
  },
  {
    name: "get_sitemaps",
    displayName: "List Sitemaps",
    description: "List the sitemaps registered for a Search Console property.",
    parametersSchema: {
      type: "object",
      properties: {
        site_url: { title: "Site Url", type: "string" },
      },
      required: ["site_url"],
    },
  },
  {
    name: "inspect_url_enhanced",
    displayName: "Inspect URL",
    description: "Inspect a URL for indexing state and rich result coverage.",
    parametersSchema: {
      type: "object",
      properties: {
        site_url: { title: "Site Url", type: "string" },
        page_url: { title: "Page Url", type: "string" },
      },
      required: ["site_url", "page_url"],
    },
  },
  {
    name: "batch_url_inspection",
    displayName: "Batch URL Inspection",
    description: "Inspect multiple URLs for a Search Console property in one call.",
    parametersSchema: {
      type: "object",
      properties: {
        site_url: { title: "Site Url", type: "string" },
        urls: { title: "Urls", type: "string" },
      },
      required: ["site_url", "urls"],
    },
  },
  {
    name: "check_indexing_issues",
    displayName: "Check Indexing Issues",
    description: "Check multiple URLs for indexing issues using the Search Console inspection APIs.",
    parametersSchema: {
      type: "object",
      properties: {
        site_url: { title: "Site Url", type: "string" },
        urls: { title: "Urls", type: "string" },
      },
      required: ["site_url", "urls"],
    },
  },
  {
    name: "get_performance_overview",
    displayName: "Get Performance Overview",
    description: "Return an overview of clicks, impressions, CTR, and position for a property.",
    parametersSchema: {
      type: "object",
      properties: {
        site_url: { title: "Site Url", type: "string" },
        days: { default: 28, title: "Days", type: "integer" },
      },
      required: ["site_url"],
    },
  },
  {
    name: "get_advanced_search_analytics",
    displayName: "Get Advanced Search Analytics",
    description: "Fetch advanced search analytics with filters, sorting, and pagination.",
    parametersSchema: {
      type: "object",
      properties: {
        site_url: { title: "Site Url", type: "string" },
        start_date: { default: null, title: "Start Date", type: "string" },
        end_date: { default: null, title: "End Date", type: "string" },
        dimensions: { default: "query", title: "Dimensions", type: "string" },
        search_type: { default: "WEB", title: "Search Type", type: "string" },
        row_limit: { default: 1000, title: "Row Limit", type: "integer" },
        start_row: { default: 0, title: "Start Row", type: "integer" },
        sort_by: { default: "clicks", title: "Sort By", type: "string" },
        sort_direction: { default: "descending", title: "Sort Direction", type: "string" },
        filter_dimension: { default: null, title: "Filter Dimension", type: "string" },
        filter_operator: { default: "contains", title: "Filter Operator", type: "string" },
        filter_expression: { default: null, title: "Filter Expression", type: "string" },
      },
      required: ["site_url"],
    },
  },
  {
    name: "compare_search_periods",
    displayName: "Compare Search Periods",
    description: "Compare Search Console performance between two date ranges.",
    parametersSchema: {
      type: "object",
      properties: {
        site_url: { title: "Site Url", type: "string" },
        period1_start: { title: "Period1 Start", type: "string" },
        period1_end: { title: "Period1 End", type: "string" },
        period2_start: { title: "Period2 Start", type: "string" },
        period2_end: { title: "Period2 End", type: "string" },
        dimensions: { default: "query", title: "Dimensions", type: "string" },
        limit: { default: 10, title: "Limit", type: "integer" },
      },
      required: ["site_url", "period1_start", "period1_end", "period2_start", "period2_end"],
    },
  },
  {
    name: "get_search_by_page_query",
    displayName: "Get Page Queries",
    description: "Break down a page's search performance by query.",
    parametersSchema: {
      type: "object",
      properties: {
        site_url: { title: "Site Url", type: "string" },
        page_url: { title: "Page Url", type: "string" },
        days: { default: 28, title: "Days", type: "integer" },
      },
      required: ["site_url", "page_url"],
    },
  },
  {
    name: "list_sitemaps_enhanced",
    displayName: "List Sitemaps Enhanced",
    description: "List sitemaps with additional detail, including sitemap indexes.",
    parametersSchema: {
      type: "object",
      properties: {
        site_url: { title: "Site Url", type: "string" },
        sitemap_index: { default: null, title: "Sitemap Index", type: "string" },
      },
      required: ["site_url"],
    },
  },
  {
    name: "get_sitemap_details",
    displayName: "Get Sitemap Details",
    description: "Get detailed status information for a specific sitemap.",
    parametersSchema: {
      type: "object",
      properties: {
        site_url: { title: "Site Url", type: "string" },
        sitemap_url: { title: "Sitemap Url", type: "string" },
      },
      required: ["site_url", "sitemap_url"],
    },
  },
  {
    name: "submit_sitemap",
    displayName: "Submit Sitemap",
    description: "Submit or resubmit a sitemap to Google Search Console.",
    parametersSchema: {
      type: "object",
      properties: {
        site_url: { title: "Site Url", type: "string" },
        sitemap_url: { title: "Sitemap Url", type: "string" },
      },
      required: ["site_url", "sitemap_url"],
    },
  },
  {
    name: "delete_sitemap",
    displayName: "Delete Sitemap",
    description: "Remove a sitemap from Google Search Console.",
    parametersSchema: {
      type: "object",
      properties: {
        site_url: { title: "Site Url", type: "string" },
        sitemap_url: { title: "Sitemap Url", type: "string" },
      },
      required: ["site_url", "sitemap_url"],
    },
  },
  {
    name: "manage_sitemaps",
    displayName: "Manage Sitemaps",
    description: "Run list, detail, submit, or delete sitemap operations through one tool.",
    parametersSchema: {
      type: "object",
      properties: {
        site_url: { title: "Site Url", type: "string" },
        action: { title: "Action", type: "string" },
        sitemap_url: { default: null, title: "Sitemap Url", type: "string" },
        sitemap_index: { default: null, title: "Sitemap Index", type: "string" },
      },
      required: ["site_url", "action"],
    },
  },
  {
    name: "get_creator_info",
    displayName: "Get Creator Info",
    description: "Return metadata about the Google Search Console MCP author.",
    parametersSchema: {
      type: "object",
      properties: {},
    },
  },
];
