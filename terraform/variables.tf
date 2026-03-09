variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name used as a prefix for all resources"
  type        = string
  default     = "credpal"
}

variable "environment" {
  description = "Deployment environment (production / staging)"
  type        = string
  default     = "production"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "domain_name" {
  description = "Fully-qualified domain name for the application (e.g. api.credpal.com)"
  type        = string
}

variable "hosted_zone_name" {
  description = "Route 53 hosted zone name (e.g. credpal.com)"
  type        = string
}

variable "container_image" {
  description = "Docker image URI to deploy (e.g. ghcr.io/org/credpal-node-app:sha-abc123)"
  type        = string
}

variable "desired_count" {
  description = "Number of ECS task replicas to run"
  type        = number
  default     = 2
}

variable "db_host" {
  description = "Hostname for the PostgreSQL database"
  type        = string
}

variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "credpal"
}
