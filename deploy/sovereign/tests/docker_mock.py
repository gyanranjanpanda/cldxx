"""Small Docker CLI stand-in for installer smoke tests; never starts containers."""

import sys

args = sys.argv[1:]
joined = " ".join(args)

if args[:1] == ["info"]:
    print("mock-docker")
elif args[:1] == ["run"]:
    if "hash-local-password.mjs" in joined:
        print("0" * 32 + ":" + "0" * 128)
    else:
        print("mock-loader")
elif args[:1] == ["network"]:
    print("false" if "cldx-sovereign_ingress" in joined else "true")
elif args[:1] == ["volume"]:
    print("mock-volume")
elif args[:1] == ["compose"]:
    if "exec" in args and "1.1.1.1" in joined:
        sys.exit(1)
    if "ps" in args and "--format" not in args:
        print("mock-container")
    elif "port" in args:
        print("127.0.0.1:8080")
    elif "--version" in args:
        print("v22")
    elif "version" in args:
        print("Docker Compose v2")
