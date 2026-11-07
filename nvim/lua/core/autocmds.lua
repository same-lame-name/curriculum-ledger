--- ~/.config/nvim/lua/core/autocmds.lua
-- Global event listeners and editor hooks.
-- These run continuously regardless of the active project or domain.

local augroup = vim.api.nvim_create_augroup("UserGlobalHooks", { clear = true })

-- ============================================================================
-- 1. Format on Save (EFM Integration)
-- ============================================================================
-- Intercepts the write command and forces synchronous formatting via EFM
-- before the file is actually written to disk.
vim.api.nvim_create_autocmd("BufWritePre", {
    group = augroup,
    pattern = {
        "*.lua", "*.py", "*.go", "*.js", "*.jsx", "*.ts", "*.tsx",
        "*.json", "*.css", "*.scss", "*.html", "*.sh", "*.bash",
        "*.zsh", "*.c", "*.cpp", "*.h", "*.hpp",
    },
    callback = function(args)
        -- Guard clauses: Only format real, modifiable, named buffers
        if vim.bo[args.buf].buftype ~= "" then return end
        if not vim.bo[args.buf].modifiable then return end
        if vim.api.nvim_buf_get_name(args.buf) == "" then return end

        -- Verify EFM language server is actually attached to this buffer
        local has_efm = false
        for _, client in ipairs(vim.lsp.get_clients({ bufnr = args.buf })) do
            if client.name == "efm" then
                has_efm = true
                break
            end
        end
        if not has_efm then return end

        -- Execute the format request safely with a 2-second timeout
        -- Wrapped in pcall to prevent saving from failing if the formatter crashes
        pcall(vim.lsp.buf.format, {
            bufnr = args.buf,
            timeout_ms = 2000,
            filter = function(client) return client.name == "efm" end,
        })
    end,
})

-- ============================================================================
-- 2. Visual Feedback
-- ============================================================================
-- Briefly highlights text when it is yanked (copied), providing visual confirmation.
vim.api.nvim_create_autocmd("TextYankPost", {
    group = augroup,
    desc = "Highlight text on yank",
    callback = function()
        vim.hl.on_yank({ higroup = "IncSearch", timeout = 150 })
    end,
})

-- ============================================================================
-- 3. Buffer State Restoration
-- ============================================================================
-- Automatically jumps to the last known cursor position when reopening a file.
vim.api.nvim_create_autocmd("BufReadPost", {
    group = augroup,
    desc = "Restore last cursor position",
    callback = function()
        -- Do not jump if in diff mode (e.g., resolving git conflicts)
        if vim.o.diff then return end
        local last_pos = vim.api.nvim_buf_get_mark(0, '"')
        local last_line = vim.api.nvim_buf_line_count(0)
        local row = last_pos[1]
        -- Ensure the saved line number actually exists in the current file
        if row > 0 and row <= last_line then
            pcall(vim.api.nvim_win_set_cursor, 0, last_pos)
        end
    end,
})

-- ============================================================================
-- 4. Filetype Specific Overrides
-- ============================================================================
-- Enables word wrapping and spell checking strictly for prose/documentation files.
vim.api.nvim_create_autocmd("FileType", {
    group = augroup,
    pattern = { "markdown", "text", "gitcommit" },
    callback = function()
        vim.opt_local.wrap = true
        vim.opt_local.linebreak = true
        vim.opt_local.spell = true
    end,
})
