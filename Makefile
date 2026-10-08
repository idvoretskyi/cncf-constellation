.PHONY: help data check serve clean

help: ## Show this help
	@grep -E '^[a-z]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-8s %s\n", $$1, $$2}'

data: ## Fetch the CNCF landscape dump and distill site/data/landscape.json
	node scripts/build-data.mjs

check: ## Sanity-check the generated dataset
	node scripts/check-data.mjs

serve: ## Serve the site on http://localhost:8080
	@echo "→ http://localhost:8080"
	@python3 -m http.server 8080 --directory site

clean: ## Remove generated data
	rm -f site/data/landscape.json
