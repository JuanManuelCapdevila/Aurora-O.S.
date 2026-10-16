#!/bin/sh
# shellcheck disable=SC2016  # $HOME se expande dentro de sh -c
exec foot -e sh -c 'aurora-hw-report "$HOME/hw-report.txt" && less "$HOME/hw-report.txt"'
