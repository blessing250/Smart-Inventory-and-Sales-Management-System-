FROM maven:3.10.0-eclipse-temurin-25-noble AS build
WORKDIR /source
COPY pom.xml .
COPY src ./src
RUN mvn -B -ntp verify

FROM eclipse-temurin:25-jre-noble
WORKDIR /app
COPY --from=build /source/target/bizflow-backend-0.1.0-SNAPSHOT.jar /app/bizflow.jar
USER 10001:10001
EXPOSE 8081
ENTRYPOINT ["java", "-jar", "/app/bizflow.jar"]
