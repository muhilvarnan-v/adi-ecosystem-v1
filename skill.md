---
name: data-product-sensible-defaults
description: This skill should be used when establishing, evaluating, or auditing technical stacks for analytical data management, analytics, data engineering, and data product lifecycle management.
triggers:
- data product
- analytical data
- data engineering
- batch analytical processing
- data platform
- data warehouse
---

# Data Product Sensible Defaults

An overview of the recommended technical stack and guidelines for Analytical Data Management, Analytics, and Data Products to prevent ecosystem fragmentation and maximize time-to-value.

## Core Instructions

When building, deploying, or managing data infrastructure and analytics pipelines, adhere to the following directives:
**Platform Enforcement:** Avoid handcrafting Data Products or managing data infrastructure manually. It is strongly recommended to leverage **Self-Service Data Platform services** to automate the lifecycle, infrastructure management, monitoring, and alerting.
**Primary Programming Language:** Use **Python** as the standard language. The Python ecosystem provides universal support for workflow management, data processing, and machine learning.
**Cloud Infrastructure Environment:** Default to **Google Cloud Platform (GCP)**. GCP provides a highly optimized suite of managed services for analytical data management, analytics, machine learning, and business intelligence.
**Business Intelligence (BI):** Standardize on **Sisense** as the organization's corporate BI platform choice.
**Data Governance & Access:** Utilize platform-provided services consisting of a **Metadata Management Service** (built on top of Google Data Catalog) and centralized **Data Access Management** via an AuthZ system.

## Common Patterns

### 1. Processing Small to Medium Datasets (Megabytes up to 1 GB)
For batch analytical processing of smaller data footprints that do not require highly complex transformations[cite: 24]:
**Workflow Management:** Google Cloud Composer (Apache Airflow)[cite: 24].
**Object Store:** Google Cloud Storage[cite: 24].
* **Output Ports File Format:** Parquet[cite: 24].
* **Data Warehouse:** BigQuery[cite: 24].
* **Data Processing / Transformations:** Pandas[cite: 25].
* *Note on Dask:* Teams can experiment with **Dask** to evaluate lazy processing and memory optimization, but it is currently classified under "Assess" rather than a firm sensible default[cite: 24, 25].

### 2. Processing Large Datasets (> 1 GB)
For large-scale data engineering batches or medium datasets containing highly complex transformation logic[cite: 25]:
* **Workflow Management:** Google Cloud Composer (Apache Airflow)[cite: 25].
* **Object Store:** Google Cloud Storage[cite: 25].
* **File Format:** Parquet[cite: 25].
* **Data Warehouse:** BigQuery[cite: 25].
* **Data Processing / Transformations:** **PySpark with Dataproc** or **Google Cloud Dataflow** depending on specific project use cases[cite: 25].

### 3. Streaming & Microbatch Processing
* **Status:** There are currently no official sensible defaults established for end-to-end streaming architectures due to a lack of historic operational use cases[cite: 25]. Core recommendations will expand once more real-world production telemetry is evaluated[cite: 25].
