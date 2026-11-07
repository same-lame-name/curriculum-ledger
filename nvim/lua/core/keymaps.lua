-- ~/.config/nvim/lua/core/keymaps.lua
-- Global editor keybindings. Organized by operational domain.

-- Set master leader keys
vim.g.mapleader = " "
vim.g.maplocalleader = " "

-- ============================================================================
-- 1. Core Movement & Navigation
-- ============================================================================

-- Wrap-aware vertical movement (moves by visual line, not logical line, unless prefixed with a count)
vim.keymap.set("n", "j", function()
	return vim.v.count == 0 and "gj" or "j"
end, { expr = true, silent = true, desc = "Down (wrap-aware)" })

vim.keymap.set("n", "k", function()
	return vim.v.count == 0 and "gk" or "k"
end, { expr = true, silent = true, desc = "Up (wrap-aware)" })

-- Keep cursor centered during large vertical jumps
vim.keymap.set("n", "<C-d>", "<C-d>zz", { desc = "Half page down (centered)" })
vim.keymap.set("n", "<C-u>", "<C-u>zz", { desc = "Half page up (centered)" })

-- ============================================================================
-- 2. Search & Highlighting
-- ============================================================================

vim.keymap.set("n", "<leader>ch", ":nohlsearch<CR>", { desc = "Clear search highlights" })

-- Keep cursor centered while cycling through search matches
vim.keymap.set("n", "n", "nzzzv", { desc = "Next search result (centered)" })
vim.keymap.set("n", "N", "Nzzzv", { desc = "Previous search result (centered)" })

-- ============================================================================
-- 3. Clipboard & Registers
-- ============================================================================

-- Paste over visual selection without overwriting the default register with deleted text
vim.keymap.set("x", "<leader>p", '"_dP', { desc = "Paste without yanking" })

-- Delete text into the black hole register (completely discards it)
vim.keymap.set({ "n", "v" }, "<leader>x", '"_d', { desc = "Delete without yanking" })

-- ============================================================================
-- 4. Buffer Management
-- ============================================================================

vim.keymap.set("n", "<leader>bn", ":bnext<CR>", { desc = "Next buffer" })
vim.keymap.set("n", "<leader>bp", ":bprevious<CR>", { desc = "Previous buffer" })

-- Fast disk write (skips write if buffer is unmodified)
vim.keymap.set("n", "<leader>bw", ":update<CR>", { desc = "Save current buffer" })

-- Safe buffer deletion (requires mini.bufremove to prevent split collapsing)
vim.keymap.set("n", "<leader>bd", function()
	require("mini.bufremove").delete(0, false)
end, { desc = "Close current buffer (keep split)" })
vim.keymap.set("n", "<leader>bD", function()
	require("mini.bufremove").delete(0, true)
end, { desc = "Force close buffer (discard changes)" })

-- Clean workspace: closes all hidden/inactive buffers
vim.keymap.set("n", "<leader>bo", function()
	local current = vim.api.nvim_get_current_buf()
	for _, buf in ipairs(vim.api.nvim_list_bufs()) do
		if buf ~= current and vim.api.nvim_buf_is_loaded(buf) then
			require("mini.bufremove").delete(buf, false)
		end
	end
end, { desc = "Close all OTHER buffers" })

-- Anchor Neovim's working directory to the folder containing the active file
vim.keymap.set("n", "<leader>cd", function()
	local dir = vim.fn.expand("%:p:h")
	vim.cmd("cd " .. dir)
	vim.notify("CWD set to: " .. dir, vim.log.levels.INFO)
end, { desc = "CD to current file's directory" })

-- ============================================================================
-- 5. Window Split Management
-- ============================================================================

-- Split generation
vim.keymap.set("n", "<leader>sv", ":vsplit<CR>", { desc = "Split window vertically" })
vim.keymap.set("n", "<leader>sh", ":split<CR>", { desc = "Split window horizontally" })

-- Split navigation
vim.keymap.set("n", "<C-h>", "<C-w>h", { desc = "Move focus to left split" })
vim.keymap.set("n", "<C-j>", "<C-w>j", { desc = "Move focus to bottom split" })
vim.keymap.set("n", "<C-k>", "<C-w>k", { desc = "Move focus to top split" })
vim.keymap.set("n", "<C-l>", "<C-w>l", { desc = "Move focus to right split" })

-- Split resizing
vim.keymap.set("n", "<C-Up>", ":resize +2<CR>", { desc = "Increase window height" })
vim.keymap.set("n", "<C-Down>", ":resize -2<CR>", { desc = "Decrease window height" })
vim.keymap.set("n", "<C-Left>", ":vertical resize -2<CR>", { desc = "Decrease window width" })
vim.keymap.set("n", "<C-Right>", ":vertical resize +2<CR>", { desc = "Increase window width" })

-- ============================================================================
-- 6. Text Manipulation
-- ============================================================================

-- Alt-Move: Shift lines up and down while automatically handling auto-indentation
vim.keymap.set("n", "<A-j>", ":m .+1<CR>==", { desc = "Move line down" })
vim.keymap.set("n", "<A-k>", ":m .-2<CR>==", { desc = "Move line up" })
vim.keymap.set("v", "<A-j>", ":m '>+1<CR>gv=gv", { desc = "Move selection down" })
vim.keymap.set("v", "<A-k>", ":m '<-2<CR>gv=gv", { desc = "Move selection up" })

-- Maintain visual selection after shifting indent
vim.keymap.set("v", "<", "<gv", { desc = "Indent left and reselect" })
vim.keymap.set("v", ">", ">gv", { desc = "Indent right and reselect" })

-- Join lines without moving the cursor to the end of the line
vim.keymap.set("n", "J", "mzJ`z", { desc = "Join lines and maintain cursor position" })

-- ============================================================================
-- 7. Editor Utilities
-- ============================================================================

-- Diagnostic toggling (useful for reading raw text without virtual text clutter)
vim.keymap.set("n", "<leader>td", function()
	vim.diagnostic.enable(not vim.diagnostic.is_enabled())
end, { desc = "Toggle inline diagnostics" })

-- Copy absolute file path to system clipboard
vim.keymap.set("n", "<leader>pa", function()
	local path = vim.fn.expand("%:p")
	vim.fn.setreg("+", path)
	vim.notify("Copied to clipboard: " .. path, vim.log.levels.INFO)
end, { desc = "Copy absolute file path" })
