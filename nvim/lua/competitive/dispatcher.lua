-- ~/.config/nvim/lua/competitive/dispatcher.lua
-- Execution engine for compiling and running competitive programming files.
-- Uses synchronous system calls to ensure strict execution order and buffer states.

local M = {}

-- Maps filetypes to their respective compilation and execution commands
local function get_exec_commands()
    local ft = vim.bo.filetype
    local file = vim.fn.shellescape(vim.fn.expand("%"))
    local file_no_ext_raw = vim.fn.expand("%:t:r")
    local file_no_ext = vim.fn.shellescape(file_no_ext_raw)
    local commands = {}

    if ft == "cpp" then
        local bin = vim.fn.shellescape("./bin/" .. file_no_ext_raw)
        local base_flags = "-D LOCAL -std=c++17 -Wshadow -Wall -O2 -Wno-unused-result -Winvalid-pch"
        local debug_flags = "-D LOCAL -std=c++17 -Wshadow -Wall -fsanitize=address -fsanitize=undefined -D_GLIBCXX_DEBUG -Winvalid-pch"

        commands.compile = string.format("g++ %s -o %s %s", file, bin, base_flags)
        commands.run = string.format("%s", bin)
        commands.compile_debug = string.format("g++ %s -o %s %s", file, bin, debug_flags)
        commands.runner = string.format("g++ runner.cpp %s -o ./bin/runner -D RUNNER %s && ./bin/runner %s > runner.txt", file, base_flags, file_no_ext)
    elseif ft == "python" then
        commands.compile = "echo 'Python does not require compilation'"
        commands.run = string.format("python3 %s", file)
        commands.compile_debug = commands.compile
        commands.runner = commands.run
    elseif ft == "java" then
        commands.compile = string.format("javac %s", file)
        commands.run = string.format("java %s", file_no_ext)
        commands.compile_debug = commands.compile
        commands.runner = commands.run
    else
        commands.compile = string.format("echo 'Compilation not defined for %s'", ft)
        commands.run = string.format("echo 'Execution not defined for %s'", ft)
        commands.compile_debug = commands.compile
        commands.runner = commands.run
    end

    return commands
end

-- Guard clause: ensures commands only run within an active competitive session
local function execute_if_active(action)
    if not require("competitive.init").is_active then
        vim.notify("Not in competitive session", vim.log.levels.WARN)
        return
    end
    -- Ensure the source file is saved before execution
    vim.cmd("silent! update")
    action()
end

-- Synchronous execution router
-- Blocks editor for milliseconds, captures output, and routes to UI notifications
local function execute_sync(cmd_string, success_msg)
    local output = vim.fn.system(cmd_string)
    -- Force Neovim to instantly reload any external file changes (e.g., output.txt)
    vim.cmd("checktime")
    -- vim.v.shell_error grabs the exit code (e.g., 0 for success, 1 for crash/compile error)
    if vim.v.shell_error ~= 0 then
        vim.notify("ERROR:\n" .. output, vim.log.levels.ERROR)
    else
        -- If the command succeeded but produced output (like Python/Java printing), show it.
        -- If it was just a silent compilation, just show the success_msg.
        local final_msg = output == "" and success_msg or (success_msg .. "\n" .. output)
        vim.notify(final_msg, vim.log.levels.INFO)
    end
end

-- Exposed execution flows
function M.compile()
    execute_if_active(function()
        execute_sync(get_exec_commands().compile, "Compilation Successful")
    end)
end

function M.run()
    execute_if_active(function()
        execute_sync(get_exec_commands().run, "Execution Finished")
    end)
end

function M.compile_and_run()
    execute_if_active(function()
        local cmds = get_exec_commands()
        execute_sync(cmds.compile .. " && " .. cmds.run, "Compile & Run Successful")
    end)
end

function M.compile_with_flag()
    execute_if_active(function()
        execute_sync(get_exec_commands().compile_debug, "Debug Compilation Successful")
    end)
end

function M.compile_and_run_with_runner()
    execute_if_active(function()
        execute_sync(get_exec_commands().runner, "Runner Executed Successfully")
        vim.cmd("e runner.txt")
    end)
end

-- Automated test case routing: Pastes clipboard into input.txt, saves, and executes
function M.get_and_run()
    execute_if_active(function()
        local input_win = vim.fn.bufwinnr("input.txt")
        if input_win == -1 then
            vim.notify("input.txt is not visible in any split!", vim.log.levels.ERROR)
            return
        end

        local starting_win = vim.fn.winnr()
        vim.cmd(input_win .. "wincmd w")

        vim.cmd('normal! gg"_dG"+P')
        vim.cmd('silent! g/^\\s*$/d')
        vim.cmd('silent! write')
        vim.cmd(starting_win .. "wincmd w")

        vim.cmd('silent! write')
        execute_sync(get_exec_commands().run, "Test Case Executed")
    end)
end

return M
