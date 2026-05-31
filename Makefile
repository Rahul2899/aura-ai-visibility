.PHONY: up down migrate initdb seed audit report eval install

install:
	pip install -r requirements.txt

up:
	docker-compose up -d
	@echo "Postgres running on localhost:5432"

down:
	docker-compose down

migrate:
	alembic upgrade head

initdb:
	python -m src.cli initdb

seed:
	@test -n "$(BRAND)" || (echo "Usage: make seed BRAND='N26'" && exit 1)
	python -m src.cli seed --brand-name "$(BRAND)" $(if $(DOMAIN),--domain "$(DOMAIN)",) $(if $(PROMPTS),--prompts-file "$(PROMPTS)",)

audit:
	@test -n "$(BRAND_ID)" || (echo "Usage: make audit BRAND_ID=1" && exit 1)
	python -m src.cli audit $(BRAND_ID)

report:
	@test -n "$(BRAND_ID)" || (echo "Usage: make report BRAND_ID=1" && exit 1)
	python -m src.cli report $(BRAND_ID) --format $(or $(FORMAT),text)

eval:
	python -m src.eval.evaluate
