// ============================================================
// DEMO GRAPH — Sample data shown on first load before a real
// project is scanned. Represents a small web application to
// showcase DepGraph's visualization capabilities.
// ============================================================

const DEMO_GRAPH_DATA = (() => {
    // --- Color palette (directory-based) ---
    const C = {
        core:    '#6366f1',  // indigo
        api:     '#3b82f6',  // blue
        ui:      '#10b981',  // emerald
        utils:   '#f59e0b',  // amber
        models:  '#8b5cf6',  // violet
        config:  '#ef4444',  // red
        auth:    '#ec4899',  // pink
        db:      '#14b8a6',  // teal
    };

    // --- Risk classification helper ---
    function r(risk, dirColor) {
        const riskColors = {
            critical: '#ef4444',
            high:     '#f97316',
            warning:  '#eab308',
            normal:   '#3b82f6',
            entry:    '#22c55e',
            system:   '#6b7280',
        };
        return { risk, risk_color: riskColors[risk] || riskColors.normal, dir_color: dirColor };
    }

    // --- Nodes ---
    const nodes = [
        // Core
        { data: { id: 'src/app.ts',            color: C.core,   size: 110, ...r('critical', C.core)   } },
        { data: { id: 'src/router.ts',          color: C.core,   size: 90,  ...r('high', C.core)       } },
        { data: { id: 'src/main.ts',            color: C.core,   size: 70,  ...r('entry', C.core)      } },

        // API layer
        { data: { id: 'src/api/client.ts',      color: C.api,    size: 95,  ...r('high', C.api)        } },
        { data: { id: 'src/api/users.ts',       color: C.api,    size: 70,  ...r('normal', C.api)      } },
        { data: { id: 'src/api/products.ts',    color: C.api,    size: 65,  ...r('normal', C.api)      } },
        { data: { id: 'src/api/orders.ts',      color: C.api,    size: 60,  ...r('normal', C.api)      } },

        // UI components
        { data: { id: 'src/ui/Dashboard.tsx',   color: C.ui,     size: 85,  ...r('high', C.ui)         } },
        { data: { id: 'src/ui/UserList.tsx',    color: C.ui,     size: 65,  ...r('normal', C.ui)       } },
        { data: { id: 'src/ui/ProductCard.tsx', color: C.ui,     size: 60,  ...r('normal', C.ui)       } },
        { data: { id: 'src/ui/OrderView.tsx',   color: C.ui,     size: 60,  ...r('normal', C.ui)       } },
        { data: { id: 'src/ui/Layout.tsx',      color: C.ui,     size: 75,  ...r('warning', C.ui)      } },
        { data: { id: 'src/ui/Sidebar.tsx',     color: C.ui,     size: 55,  ...r('normal', C.ui)       } },

        // Utils
        { data: { id: 'src/utils/format.ts',    color: C.utils,  size: 80,  ...r('high', C.utils)      } },
        { data: { id: 'src/utils/validate.ts',  color: C.utils,  size: 70,  ...r('normal', C.utils)    } },
        { data: { id: 'src/utils/logger.ts',    color: C.utils,  size: 85,  ...r('high', C.utils)      } },

        // Models
        { data: { id: 'src/models/User.ts',     color: C.models, size: 70,  ...r('normal', C.models)   } },
        { data: { id: 'src/models/Product.ts',  color: C.models, size: 65,  ...r('normal', C.models)   } },
        { data: { id: 'src/models/Order.ts',    color: C.models, size: 60,  ...r('normal', C.models)   } },

        // Auth
        { data: { id: 'src/auth/guard.ts',      color: C.auth,   size: 75,  ...r('warning', C.auth)    } },
        { data: { id: 'src/auth/session.ts',    color: C.auth,   size: 70,  ...r('normal', C.auth)     } },

        // DB / data layer
        { data: { id: 'src/db/connection.ts',   color: C.db,     size: 80,  ...r('high', C.db)         } },
        { data: { id: 'src/db/queries.ts',      color: C.db,     size: 70,  ...r('normal', C.db)       } },

        // Config
        { data: { id: 'src/config/index.ts',    color: C.config, size: 75,  ...r('warning', C.config)  } },
    ];

    // --- Edges ---
    const E = '#94a3b8';   // default edge color
    const CE = '#FF4136';  // cycle edge color
    function edge(src, tgt, cycle) {
        return {
            group: 'edges',
            data: { source: src, target: tgt, color: cycle ? CE : E, id: 'e:' + src + '→' + tgt },
            classes: cycle ? 'cycle' : '',
        };
    }

    const edges = [
        // main → app → router
        edge('src/main.ts',            'src/app.ts'),
        edge('src/app.ts',             'src/router.ts'),
        edge('src/app.ts',             'src/config/index.ts'),

        // router → UI
        edge('src/router.ts',          'src/ui/Dashboard.tsx'),
        edge('src/router.ts',          'src/ui/UserList.tsx'),
        edge('src/router.ts',          'src/ui/OrderView.tsx'),
        edge('src/router.ts',          'src/auth/guard.ts'),

        // UI → API
        edge('src/ui/Dashboard.tsx',   'src/api/client.ts'),
        edge('src/ui/Dashboard.tsx',   'src/ui/Sidebar.tsx'),
        edge('src/ui/UserList.tsx',    'src/api/users.ts'),
        edge('src/ui/ProductCard.tsx', 'src/api/products.ts'),
        edge('src/ui/OrderView.tsx',   'src/api/orders.ts'),
        edge('src/ui/Layout.tsx',      'src/ui/Sidebar.tsx'),
        edge('src/ui/Layout.tsx',      'src/router.ts'),

        // API → models + utils
        edge('src/api/client.ts',      'src/config/index.ts'),
        edge('src/api/client.ts',      'src/utils/logger.ts'),
        edge('src/api/users.ts',       'src/api/client.ts'),
        edge('src/api/users.ts',       'src/models/User.ts'),
        edge('src/api/products.ts',    'src/api/client.ts'),
        edge('src/api/products.ts',    'src/models/Product.ts'),
        edge('src/api/orders.ts',      'src/api/client.ts'),
        edge('src/api/orders.ts',      'src/models/Order.ts'),

        // Models → utils
        edge('src/models/User.ts',     'src/utils/validate.ts'),
        edge('src/models/Product.ts',  'src/utils/format.ts'),
        edge('src/models/Order.ts',    'src/utils/format.ts'),

        // Auth
        edge('src/auth/guard.ts',      'src/auth/session.ts'),
        edge('src/auth/session.ts',    'src/db/connection.ts'),
        edge('src/auth/guard.ts',      'src/utils/logger.ts'),

        // DB
        edge('src/db/queries.ts',      'src/db/connection.ts'),
        edge('src/db/connection.ts',   'src/config/index.ts'),
        edge('src/api/users.ts',       'src/db/queries.ts'),
        edge('src/api/orders.ts',      'src/db/queries.ts'),

        // Utils cross-deps
        edge('src/utils/validate.ts',  'src/utils/format.ts'),
        edge('src/utils/logger.ts',    'src/config/index.ts'),

        // --- Cycle: Dashboard ↔ Layout (intentional circular dependency) ---
        edge('src/ui/Dashboard.tsx',   'src/ui/Layout.tsx', true),
        edge('src/ui/Layout.tsx',      'src/ui/Dashboard.tsx', true),
    ];

    // --- Coupling ---
    const coupling = [
        { dir1: 'src/api', dir2: 'src/models', cross_edges: 3, score: 0.35 },
        { dir1: 'src/ui',  dir2: 'src/api',    cross_edges: 4, score: 0.28 },
        { dir1: 'src/api', dir2: 'src/db',     cross_edges: 2, score: 0.22 },
        { dir1: 'src/auth',dir2: 'src/db',     cross_edges: 1, score: 0.15 },
    ];

    return {
        nodes,
        edges,
        has_cycles: true,
        cycles: [['src/ui/Dashboard.tsx', 'src/ui/Layout.tsx', 'src/ui/Dashboard.tsx']],
        unused_files: [],
        coupling,
        detected: { has_js: true, has_c: false, has_py: false },
        _isDemo: true,
    };
})();
