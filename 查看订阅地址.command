#!/bin/zsh
task_project_dir="${0:A:h}"
exec /usr/bin/python3 -B "$task_project_dir/subscription_server.py" status
