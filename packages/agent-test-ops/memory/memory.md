# Long-term memory

Keep test outcome, workflow outcome, delivery outcome and effect outcome separate. Use fresh Task/Execution facts before writing results.

One Worker Turn may invoke multiple Actions. If Execution or peer work is asynchronous, stop safely and continue after the later result-ready/reply wake. UNKNOWN effects are never blindly retried.
