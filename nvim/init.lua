-- ~/.config/nvim/init.lua
-- Main entry point. Load order is strictly enforced.

-- 1. Package Manager (Syncs and loads binaries into runtime)
require("core.plugins")

-- 2. Editor Baseline (State, bindings, hooks, custom UI)
require("core.options")
require("core.keymaps")
require("core.autocmds")
require("core.ui")

-- 3. Plugin Configurations (Domain-isolated modules)
require("core.treesitter") -- AST parsing and syntax highlighting
require("core.tools") -- UI components, file navigation, and editor utilities
require("core.lsp") -- Language servers, autocompletion, and formatting engines

-- 4. Competitive Engine
-- Bootstraps the tri-pane layout and execution dispatcher
require("competitive.theme_ac")
require("competitive.bindings").setup()

-- 4b. Theme-AC Engine (Guided AtCoder Practice)
-- :ThemeAC* commands + <leader>a which-key registration.
require("competitive.theme_ac.commands").setup()

-- 4c. Competitive Programming Arena (Teacher-Driven Practice & Checkpoints)
-- :Arena* commands + <leader>m which-key registration.
require("competitive.arena.commands").setup()

-- 5. Colorscheme (Gruvbox)
-- Must load last to prevent plugins from overwriting highlight groups
vim.opt.termguicolors = true
-- vim.opt.termguicolors = false
vim.opt.background = "dark" -- Enforce dark variant

require("gruvbox").setup({
	terminal_colors = true,
	undercurl = true,
	underline = true,
	bold = true,
	italic = {
		strings = false,
		emphasis = true,
		comments = true,
		operators = false,
		folds = true,
	},
	contrast = "hard", -- High contrast background
	transparent_mode = true, -- Inherit terminal opacity
})

vim.cmd.colorscheme("gruvbox")
