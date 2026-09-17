FROM ubuntu/squid:latest

# Squid's own access log goes to stdout so the egress record lands in the
# container log alongside everything else an operator already collects. A log
# that only exists inside the container is a log nobody reads.
RUN ln -sf /dev/stdout /var/log/squid/access.log

EXPOSE 3128
