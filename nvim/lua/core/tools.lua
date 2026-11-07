-- ~/.config/nvim/lua/core/tools.lua
-- Editor utilities and UI components.
-- Handles file navigation, fuzzy finding, Git integration, and lightweight editor enhancements.

-- ============================================================================
-- 1. Mini Suite (Lightweight Editor Enhancements)
-- ============================================================================
-- Initialize notification routing first to catch any subsequent startup errors
require("mini.notify").setup({})

-- UI and Visuals
require("mini.icons").setup({})
require("mini.tabline").setup({})
require("mini.indentscope").setup({})
require("mini.cursorword").setup({})
require("mini.trailspace").setup({})

-- Text Manipulation and Workflow
require("mini.ai").setup({}) -- Enhanced text objects (e.g., inside 'a'rgument)
require("mini.comment").setup({}) -- Smart commenting
require("mini.move").setup({}) -- Move lines/selections visually
require("mini.surround").setup({}) -- Manage surrounding brackets/quotes
require("mini.pairs").setup({}) -- Autoclose brackets
require("mini.bufremove").setup({}) -- Safe buffer deletion (used in keymaps.lua)

-- ============================================================================
-- 2. NvimTree (File Explorer)
-- ============================================================================
local function nvim_tree_on_attach(bufnr)
	local api = require("nvim-tree.api")
	-- Keep all the standard NvimTree keys working
	api.config.mappings.default_on_attach(bufnr)

	-- Force C and U to change the tree root directly
	-- It is a buffer-local mapping, so the key-mappings will be set only for nvim-tree window
	vim.keymap.set("n", "C", api.tree.change_root_to_node, { buffer = bufnr, nowait = true })
	vim.keymap.set("n", "U", api.tree.change_root_to_parent, { buffer = bufnr, nowait = true })
end

require("nvim-tree").setup({
	on_attach = nvim_tree_on_attach,
	view = { width = 35 },
	filters = { dotfiles = false },
	renderer = { group_empty = true },
})

vim.keymap.set("n", "<leader>e", function()
	require("nvim-tree.api").tree.toggle()
end, { desc = "Toggle NvimTree" })

-- Transparent background overrides for NvimTree to blend with Gruvbox/Terminal
vim.api.nvim_set_hl(0, "NvimTreeNormalNC", { bg = "none" })
vim.api.nvim_set_hl(0, "SignColumn", { bg = "none" })
vim.api.nvim_set_hl(0, "NvimTreeSignColumn", { bg = "none" })
vim.api.nvim_set_hl(0, "NvimTreeNormal", { bg = "none" })
vim.api.nvim_set_hl(0, "NvimTreeWinSeparator", { fg = "#2a2a2a", bg = "none" })
vim.api.nvim_set_hl(0, "NvimTreeEndOfBuffer", { bg = "none" })

-- ============================================================================
-- 3. FZF-Lua (Fuzzy Finder)
-- ============================================================================
require("fzf-lua").setup({})

vim.keymap.set("n", "<leader>ff", function()
	require("fzf-lua").files()
end, { desc = "FZF Files" })
vim.keymap.set("n", "<leader>fg", function()
	require("fzf-lua").live_grep()
end, { desc = "FZF Live Grep" })
vim.keymap.set("n", "<leader>fb", function()
	require("fzf-lua").buffers()
end, { desc = "FZF Buffers" })
vim.keymap.set("n", "<leader>fh", function()
	require("fzf-lua").help_tags()
end, { desc = "FZF Help Tags" })
vim.keymap.set("n", "<leader>fx", function()
	require("fzf-lua").diagnostics_document()
end, { desc = "FZF Diagnostics Document" })
vim.keymap.set("n", "<leader>fX", function()
	require("fzf-lua").diagnostics_workspace()
end, { desc = "FZF Diagnostics Workspace" })

-- ============================================================================
-- 4. Gitsigns (Version Control Integration)
-- ============================================================================
require("gitsigns").setup({
	signs = {
		add = { text = "▌" },
		change = { text = "▌" },
		delete = { text = "▌" },
		topdelete = { text = "‾" },
		changedelete = { text = "~" },
		untracked = { text = "┆" },
	},
	signcolumn = true,
	current_line_blame = false, -- Disabled by default to reduce visual noise
})

vim.keymap.set("n", "]h", function()
	require("gitsigns").next_hunk()
end, { desc = "Next git hunk" })
vim.keymap.set("n", "[h", function()
	require("gitsigns").prev_hunk()
end, { desc = "Previous git hunk" })
vim.keymap.set("n", "<leader>hs", function()
	require("gitsigns").stage_hunk()
end, { desc = "Stage hunk" })
vim.keymap.set("n", "<leader>hr", function()
	require("gitsigns").reset_hunk()
end, { desc = "Reset hunk" })
vim.keymap.set("n", "<leader>hp", function()
	require("gitsigns").preview_hunk()
end, { desc = "Preview hunk" })
vim.keymap.set("n", "<leader>hb", function()
	require("gitsigns").blame_line({ full = true })
end, { desc = "Blame line" })
vim.keymap.set("n", "<leader>hB", function()
	require("gitsigns").toggle_current_line_blame()
end, { desc = "Toggle inline blame" })
vim.keymap.set("n", "<leader>hd", function()
	require("gitsigns").diffthis()
end, { desc = "Diff this" })

-- ============================================================================
-- 5. Which-Key (Keymap Discovery)
-- ============================================================================
local wk = require("which-key")

wk.setup({
	preset = "modern",
})

-- Global Top-Level Namespaces (The Root UI Contract - to be honored by maintainer)
wk.add({
	{ "<leader>b", group = "Buffers" }, -- Buffer lifecycle (next, prev, close)
	{ "<leader>c", group = "Code / LSP" }, -- All LSP actions, diagnostics, and refactoring
	{ "<leader>f", group = "Find and Search" }, -- All FZF search boundaries
	{ "<leader>g", group = "Git" }, -- All version control (status, commits, hunks)
})
