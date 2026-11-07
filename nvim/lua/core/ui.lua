-- ~/.config/nvim/lua/core/ui.lua
-- Custom UI elements: Dynamic Statusline and Floating Terminal.

-- ============================================================================
-- 1. Statusline Components
-- ============================================================================
-- These functions are bound to _G (global) so they can be evaluated by 
-- Neovim's native %{v:lua...} statusline syntax.

local cached_branch = ""
local last_check = 0

-- Retrieves current git branch. Throttled to execute at most once every 5 seconds
-- to prevent blocking the UI thread with synchronous shell calls on every cursor move.
local function git_branch()
    local now = vim.loop.now()
    if now - last_check > 5000 then
        cached_branch = vim.fn.system("git branch --show-current 2>/dev/null | tr -d '\n'")
        last_check = now
    end
    if cached_branch ~= "" then
        return " \u{e725} " .. cached_branch .. " "
    end
    return ""
end

-- Maps filetypes to specific NerdFont icons
local function file_type()
    local ft = vim.bo.filetype
    local icons = {
        lua = "\u{e620} ", python = "\u{e73c} ", javascript = "\u{e74e} ", typescript = "\u{e628} ",
        javascriptreact = "\u{e7ba} ", typescriptreact = "\u{e7ba} ", html = "\u{e736} ", css = "\u{e749} ",
        scss = "\u{e749} ", json = "\u{e60b} ", markdown = "\u{e73e} ", vim = "\u{e62b} ", sh = "\u{f489} ",
        bash = "\u{f489} ", zsh = "\u{f489} ", rust = "\u{e7a8} ", go = "\u{e724} ", c = "\u{e61e} ",
        cpp = "\u{e61d} ", java = "\u{e738} ", php = "\u{e73d} ", ruby = "\u{e739} ", swift = "\u{e755} ",
        kotlin = "\u{e634} ", dart = "\u{e798} ", elixir = "\u{e62d} ", haskell = "\u{e777} ", sql = "\u{e706} ",
        yaml = "\u{f481} ", toml = "\u{e615} ", xml = "\u{f05c} ", dockerfile = "\u{f308} ", gitcommit = "\u{f418} ",
        gitconfig = "\u{f1d3} ", vue = "\u{fd42} ", svelte = "\u{e697} ", astro = "\u{e628} ",
    }

    if ft == "" then return " \u{f15b} " end
    return ((icons[ft] or " \u{f15b} ") .. ft)
end

-- Calculates human-readable file size for the active buffer
local function file_size()
    local size = vim.fn.getfsize(vim.fn.expand("%"))
    if size < 0 then return "" end
    local size_str
    if size < 1024 then
        size_str = size .. "B"
    elseif size < 1024 * 1024 then
        size_str = string.format("%.1fK", size / 1024)
    else
        size_str = string.format("%.1fM", size / 1024 / 1024)
    end
    return " \u{f016} " .. size_str .. " "
end

-- Translates Neovim's internal mode codes (n, i, V) into explicit labels
local function mode_icon()
    local mode = vim.fn.mode()
    local modes = {
        n = " \u{f121}  NORMAL", i = " \u{f11c}  INSERT", v = " \u{f0168} VISUAL", V = " \u{f0168} V-LINE",
        ["\22"] = " \u{f0168} V-BLOCK", c = " \u{f120} COMMAND", s = " \u{f0c5} SELECT", S = " \u{f0c5} S-LINE",
        ["\19"] = " \u{f0c5} S-BLOCK", R = " \u{f044} REPLACE", r = " \u{f044} REPLACE", ["!"] = " \u{f489} SHELL",
        t = " \u{f120} TERMINAL",
    }
    return modes[mode] or (" \u{f059} " .. mode)
end

-- Expose to global scope for statusline evaluation
_G.mode_icon = mode_icon
_G.git_branch = git_branch
_G.file_type = file_type
_G.file_size = file_size

-- ============================================================================
-- 2. Statusline Assembly
-- ============================================================================

vim.cmd([[highlight StatusLineBold gui=bold cterm=bold]])

local function setup_dynamic_statusline()
    -- Active window: Full details (Mode, Git, File, Size, Position)
    vim.api.nvim_create_autocmd({ "WinEnter", "BufEnter" }, {
        callback = function()
            vim.opt_local.statusline = table.concat({
                "  ", "%#StatusLineBold#", "%{v:lua.mode_icon()}", "%#StatusLine#",
                " \u{e0b1} %f %h%m%r", "%{v:lua.git_branch()}", "\u{e0b1} ", "%{v:lua.file_type()}",
                "\u{e0b1} ", "%{v:lua.file_size()}", "%=", " \u{f017} %l:%c  %P ",
            })
        end,
    })
    vim.api.nvim_set_hl(0, "StatusLineBold", { bold = true })

    -- Inactive window: Stripped down to essential file info to reduce visual noise
    vim.api.nvim_create_autocmd({ "WinLeave", "BufLeave" }, {
        callback = function()
            vim.opt_local.statusline = "  %f %h%m%r \u{e0b1} %{v:lua.file_type()} %=  %l:%c   %P "
        end,
    })
end

setup_dynamic_statusline()

-- ============================================================================
-- 3. Floating Terminal
-- ============================================================================

local term_augroup = vim.api.nvim_create_augroup("TerminalConfig", { clear = true })

-- Ensures terminal buffer is destroyed gracefully on exit code 0
vim.api.nvim_create_autocmd("TermClose", {
    group = term_augroup,
    callback = function()
        if vim.v.event.status == 0 then vim.api.nvim_buf_delete(0, {}) end
    end,
})

-- Disables editor visuals (numbers, signcolumn) inside the terminal buffer
vim.api.nvim_create_autocmd("TermOpen", {
    group = term_augroup,
    callback = function()
        vim.opt_local.number = false
        vim.opt_local.relativenumber = false
        vim.opt_local.signcolumn = "no"
    end,
})

-- Tracks the persistent background buffer and window ID
local terminal_state = { buf = nil, win = nil, is_open = false }

local function FloatingTerminal()
    -- Toggle off if currently open and valid
    if terminal_state.is_open and terminal_state.win and vim.api.nvim_win_is_valid(terminal_state.win) then
        vim.api.nvim_win_close(terminal_state.win, false)
        terminal_state.is_open = false
        return
    end

    -- Create a hidden scratch buffer if one does not exist
    if not terminal_state.buf or not vim.api.nvim_buf_is_valid(terminal_state.buf) then
        terminal_state.buf = vim.api.nvim_create_buf(false, true)
        vim.bo[terminal_state.buf].bufhidden = "hide"
    end

    -- Calculate centered floating window dimensions (80% of screen)
    local width = math.floor(vim.o.columns * 0.8)
    local height = math.floor(vim.o.lines * 0.8)
    local row = math.floor((vim.o.lines - height) / 2)
    local col = math.floor((vim.o.columns - width) / 2)

    terminal_state.win = vim.api.nvim_open_win(terminal_state.buf, true, {
        relative = "editor", width = width, height = height, row = row, col = col,
        style = "minimal", border = "rounded",
    })

    -- Transparent UI mapping for the floating window
    vim.wo[terminal_state.win].winblend = 0
    vim.wo[terminal_state.win].winhighlight = "Normal:FloatingTermNormal,FloatBorder:FloatingTermBorder"
    vim.api.nvim_set_hl(0, "FloatingTermNormal", { bg = "none" })
    vim.api.nvim_set_hl(0, "FloatingTermBorder", { bg = "none" })

    -- Check if shell is already running in buffer. If not, start it.
    local has_terminal = false
    local lines = vim.api.nvim_buf_get_lines(terminal_state.buf, 0, -1, false)
    for _, line in ipairs(lines) do
        if line ~= "" then
            has_terminal = true
            break
        end
    end
    if not has_terminal then
        vim.fn.termopen(os.getenv("SHELL"))
    end

    terminal_state.is_open = true
    vim.cmd("startinsert")

    -- Auto-close floating window if focus is lost
    vim.api.nvim_create_autocmd("BufLeave", {
        buffer = terminal_state.buf,
        callback = function()
            if terminal_state.is_open and terminal_state.win and vim.api.nvim_win_is_valid(terminal_state.win) then
                vim.api.nvim_win_close(terminal_state.win, false)
                terminal_state.is_open = false
            end
        end,
        once = true,
    })
end

-- Keybindings strictly scoped to the floating terminal lifecycle
vim.keymap.set("n", "<leader>t", FloatingTerminal, { noremap = true, silent = true, desc = "Toggle floating terminal" })
vim.keymap.set("t", "<Esc>", function()
    if terminal_state.is_open and terminal_state.win and vim.api.nvim_win_is_valid(terminal_state.win) then
        vim.api.nvim_win_close(terminal_state.win, false)
        terminal_state.is_open = false
    end
end, { noremap = true, silent = true, desc = "Close floating terminal" })
